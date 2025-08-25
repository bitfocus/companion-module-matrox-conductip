import { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } from '@companion-module/base'
import { Buffer } from 'buffer'
import https from 'https' // Using Node.js built-in https module

const API_TIMEOUT = 1000 // 5 seconds for API requests
const POLLING_INTERVAL = 1000 // 1 second for polling rooms/panels

class MatroxConductIPInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.config = {}
		this.roomsData = []
		this.panelSalvos = {}
		this.pollTimer = null
		this.currentStatus = InstanceStatus.UnknownError // Default status
		this.customHttpsAgent = undefined // For self-signed certificate handling
	}

	async init(config, _isFirstInit) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting, 'Initializing...')

		// Configure the HTTPS agent based on user preference for SSL verification
		this.configureHttpsAgent()

		this.updateActionsAndPresets() // Initial setup, possibly with empty choices

		if (this.config.host && this.config.username && this.config.password) {
			await this.fetchInitialData()
			this.setupPolling()
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration: IP/Host, Username, or Password')
		}
	}

	updateStatus(status, message = undefined) {
		super.updateStatus(status, message)
		this.currentStatus = status
	}

	getStatus() {
		return this.currentStatus || InstanceStatus.UnknownError // Return current status or default to UnknownError
	}

	configureHttpsAgent() {
		if (this.config.allowUnauthorized) {
			// Create new agent only if not already created with correct setting
			if (
				!this.customHttpsAgent ||
				(this.customHttpsAgent && this.customHttpsAgent.options.rejectUnauthorized !== false)
			) {
				this.customHttpsAgent = new https.Agent({
					rejectUnauthorized: false,
				})
				this.log('debug', 'Custom HTTPS agent configured to ALLOW unverified certificates.')
			}
		} else {
			// Revert to default (undefined means use Node's default https.globalAgent)
			if (this.customHttpsAgent) {
				// only change if it was previously custom
				this.customHttpsAgent = undefined
				this.log('debug', 'HTTPS agent configured to VERIFY certificates (default).')
			}
		}
	}

	async destroy() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		// No specific cleanup needed for customHttpsAgent unless it held OS resources not managed by GC
		this.customHttpsAgent = undefined
		this.log('debug', 'Destroyed')
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'Make sure to assign at least one room and panel to the user you use specify below.',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'ConductIP IP/Hostname',
				width: 12,
				regex: this.REGEX_IP_OR_HOSTNAME, // Provided by InstanceBase
				required: true,
			},
			{
				type: 'textinput',
				id: 'username',
				label: 'Username',
				width: 6,
				required: true,
			},
			{
				type: 'textinput',
				id: 'password',
				label: 'Password',
				width: 6,
				inputType: 'password',
				required: true,
			},
			{
				type: 'checkbox',
				id: 'allowUnauthorized',
				label: 'Allow Unverified/Self-Signed HTTPS Certificates',
				width: 12,
				default: false,
				tooltip: 'Set to true if your ConductIP device uses a self-signed HTTPS certificate.',
			},
		]
	}

	async configUpdated(config) {
		const oldAllowUnauthorized = this.config.allowUnauthorized

		this.config = config

		if (oldAllowUnauthorized !== this.config.allowUnauthorized) {
			this.configureHttpsAgent() // Reconfigure agent if this specific option changed
		}

		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}

		this.roomsData = []
		this.panelSalvos = {}
		// It's generally safest to re-run the full init logic,
		// as init also calls updateActionsAndPresets and starts polling if config is valid.
		await this.init(config, false)
	}

	async makeApiRequest(method, endpoint, requestBodyObj = null) {
		if (!this.config.host || !this.config.username || !this.config.password) {
			this.updateStatus(InstanceStatus.BadConfig, 'Configuration is incomplete.')
			return null // Return null directly, not a Promise wrapping null, to simplify calling code
		}

		const upperMethod = method.toUpperCase()
		let bodyString = null

		if ((upperMethod === 'POST' || upperMethod === 'PUT') && requestBodyObj !== null) {
			try {
				bodyString = JSON.stringify(requestBodyObj)
			} catch (e) {
				this.log('error', `Failed to stringify request body: ${e.message}`)
				this.updateStatus(InstanceStatus.ModuleError, 'Invalid request body')
				return null
			}
		}

		return new Promise((resolve) => {
			const options = {
				hostname: this.config.host,
				port: 443, // Default HTTPS port
				path: `/api${endpoint}`,
				method: upperMethod,
				headers: {
					Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
					// User-Agent is good practice
					'User-Agent': `Companion-Module/${this.id}`,
				},
				timeout: API_TIMEOUT, // in milliseconds
			}

			if (this.customHttpsAgent) {
				options.agent = this.customHttpsAgent
			}
			// If !this.config.allowUnauthorized, options.agent remains undefined, Node uses default agent which verifies certs.

			if (bodyString) {
				options.headers['Content-Type'] = 'application/json'
				options.headers['Content-Length'] = Buffer.byteLength(bodyString)
			} else if (upperMethod === 'POST' || upperMethod === 'PUT') {
				options.headers['Content-Length'] = 0 // For empty POST/PUT bodies
			}

			// this.log('debug', `Sending ${upperMethod} to https://${options.hostname}:${options.port}${options.path}`);

			const req = https.request(options, (res) => {
				let responseData = ''
				res.setEncoding('utf8')

				res.on('data', (chunk) => {
					responseData += chunk
				})

				res.on('end', () => {
					// this.log('debug', `Response ${res.statusCode} from ${options.path}: ${responseData.substring(0,100)}...`);
					if (res.statusCode >= 200 && res.statusCode < 300) {
						if (upperMethod === 'POST' && endpoint.startsWith('/salvos/') && res.statusCode === 200) {
							resolve(true) // Successfully ran salvo
							return
						}
						if (res.statusCode === 204) {
							// No Content
							resolve(true)
							return
						}
						if (responseData.trim() === '') {
							// Handle empty but successful (non-204) responses
							resolve(null) // Or true, if appropriate for your API contract
							return
						}
						try {
							const jsonData = JSON.parse(responseData)
							resolve(jsonData)
						} catch (e) {
							this.log('warn', `Failed to parse JSON response from ${endpoint}: ${e.message}. Raw: "${responseData}"`)
							this.updateStatus(InstanceStatus.UnknownError, 'Failed to parse API response')
							resolve(null)
						}
					} else {
						const userFriendlyMessage = `API Error ${res.statusCode}`
						this.log(
							'warn',
							`${userFriendlyMessage} ${res.statusMessage} for ${upperMethod} ${options.path}. Body: ${responseData}`,
						)
						let statusToSet = InstanceStatus.ConnectionFailure
						let detailedMessage = userFriendlyMessage

						if (res.statusCode === 401 || res.statusCode === 403) {
							statusToSet = InstanceStatus.BadConfig
							detailedMessage = `Authentication Failed (${res.statusCode})`
						} else if (res.statusCode === 404) {
							detailedMessage = `API Endpoint Not Found (${res.statusCode})`
						} // Add more specific 4xx/5xx handling if needed

						this.updateStatus(statusToSet, detailedMessage)
						resolve(null)
					}
				})
			})

			req.on('timeout', () => {
				req.destroy() // Important to destroy the socket on timeout
				const timeoutMessage = `Request to ${options.hostname}${options.path} timed out after ${API_TIMEOUT}ms`
				this.log('warn', timeoutMessage)
				this.updateStatus(InstanceStatus.ConnectionFailure, 'Request Timeout')
				resolve(null)
			})

			req.on('error', (e) => {
				this.log('warn', `HTTP Request to ${options.hostname}${options.path} failed: ${e.message}`)
				let userMessage = `Request failed: ${e.code || e.message}`
				let statusToSet = InstanceStatus.ConnectionFailure

				if (e.code === 'ECONNREFUSED') {
					userMessage = 'Connection refused'
				} else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
					userMessage = 'Host not found or DNS lookup failure'
				} else if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || e.message.toLowerCase().includes('certificate')) {
					if (!this.config.allowUnauthorized) {
						// Check if user intended to bypass this
						userMessage = 'Certificate validation error. Try "Allow Unverified Certificates".'
					} else {
						// If allowUnauthorized is true and still get cert error, it's a more complex SSL issue
						userMessage = `SSL Certificate error (even with bypass): ${e.message}`
					}
				}
				this.updateStatus(statusToSet, userMessage)
				resolve(null)
			})

			if (bodyString) {
				req.write(bodyString)
			}
			req.end()
		})
	}

	setupPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		if (this.config.host && this.config.username && this.config.password) {
			this.pollTimer = setInterval(async () => {
				await this.fetchRoomsAndPanels()
			}, POLLING_INTERVAL)
			this.log('debug', 'Polling started.')
		} else {
			this.log('debug', 'Polling not started due to missing config.')
		}
	}

	async fetchInitialData() {
		this.log('debug', 'Fetching initial data...')
		await this.fetchRoomsAndPanels()
	}

	async fetchRoomsAndPanels() {
		if (!this.config.host || !this.config.username || !this.config.password) {
			return
		}
		// this.log('debug',"Fetching rooms and panels...")
		const roomsInfo = await this.makeApiRequest('GET', '/rooms/info')
		this.log('debug', `Fetched rooms/panels data: ${JSON.stringify(roomsInfo)}`)

		if (roomsInfo && Array.isArray(roomsInfo)) {
			this.roomsData = roomsInfo
			if (this.getStatus() !== InstanceStatus.ConnectionFailure && this.getStatus() !== InstanceStatus.BadConfig) {
				this.updateStatus(InstanceStatus.Ok)
			}

			const newPanelSalvos = {}
			const panelPromises = []

			for (const room of this.roomsData) {
				if (room.panels && Array.isArray(room.panels)) {
					for (const panel of room.panels) {
						panelPromises.push(
							this.fetchSalvosForPanel(panel.id).then((salvos) => {
								if (salvos) {
									// salvos can be an empty array on success
									newPanelSalvos[panel.id] = salvos
								}
							}),
						)
					}
				}
			}
			// Using Promise.allSettled to ensure all promises complete, even if some fail
			const results = await Promise.allSettled(panelPromises)
			results.forEach((result, index) => {
				if (result.status === 'rejected') {
					const panelIdForFailedPromise = this.roomsData.flatMap((r) => r.panels)[index]?.id
					this.log(
						'warn',
						`A promise for fetching salvos failed (panelId around ${panelIdForFailedPromise}): ${result.reason}`,
					)
				}
			})

			this.panelSalvos = newPanelSalvos
			this.updateActionsAndPresets()
			this.updateVariableValues()
		} else if (roomsInfo === null) {
			// makeApiRequest failed, status already set and logged.
			this.log('debug', 'Polling: Failed to fetch rooms/panels, makeApiRequest returned null.')
		} else {
			// Data received but not in expected array format
			this.log(
				'warn',
				`fetchRoomsAndPanels: Received invalid data format. Expected array, got: ${JSON.stringify(roomsInfo)}`,
			)
			this.updateStatus(InstanceStatus.UnknownError, 'Invalid data format from API (rooms)')
		}
	}

	async fetchSalvosForPanel(panelId) {
		if (!panelId) {
			this.log('error', 'fetchSalvosForPanel called with no panelId')
			return [] // Return empty array to prevent issues
		}
		// this.log('debug',`Fetching salvos for panel ${panelId}...`)
		const panelInfo = await this.makeApiRequest('GET', `/panels/info/${panelId}`)
		if (panelInfo?.salvos && Array.isArray(panelInfo.salvos)) {
			return panelInfo.salvos
		}

		if (panelInfo === null) {
			// makeApiRequest failed and returned null, status handled there.
			this.log('warn', `Failed to fetch salvos for panel ${panelId} as API request failed.`)
			return []
		}

		this.log(
			'warn',
			`Invalid data format for panel ${panelId} salvos. Expected 'salvos' array. Got: ${JSON.stringify(panelInfo)}`,
		)
		// Optionally update status if this specific failure is critical and not covered by a general API error
		// this.updateStatus(InstanceStatus.UnknownError, `Invalid data for panel ${panelId} salvos`);
		return []
	}

	updateActionsAndPresets() {
		this.setActionDefinitions(this.getActions())
		this.setPresetDefinitions(this.getPresets())
		this.setVariableDefinitions(this.getVariables())
	}

	getVariables() {
		const variables = []

		// Add panel variables
		for (const room of this.roomsData) {
			if (room.panels && Array.isArray(room.panels)) {
				for (const panel of room.panels) {
					variables.push({
						variableId: `panel_${panel.id}`,
						name: `Label for panel with id ${panel.id}`,
					})
				}
			}
		}

		// Add salvo variables
		for (const panelId in this.panelSalvos) {
			const salvos = this.panelSalvos[panelId]
			if (Array.isArray(salvos)) {
				for (const salvo of salvos) {
					variables.push({
						variableId: `salvo_${salvo.id}`,
						name: `Label for salvo with id ${salvo.id}`,
					})
				}
			}
		}

		return variables
	}

	updateVariableValues() {
		const variableValues = {}

		// Set panel variable values
		for (const room of this.roomsData) {
			if (room.panels && Array.isArray(room.panels)) {
				for (const panel of room.panels) {
					variableValues[`panel_${panel.id}`] = panel.label || 'Unnamed Panel'
				}
			}
		}

		// Set salvo variable values
		for (const panelId in this.panelSalvos) {
			const salvos = this.panelSalvos[panelId]
			if (Array.isArray(salvos)) {
				for (const salvo of salvos) {
					variableValues[`salvo_${salvo.id}`] = salvo.label || 'Unnamed Salvo'
				}
			}
		}

		this.setVariableValues(variableValues)
	}

	getActions() {
		const panelChoices = this.roomsData.flatMap((room) =>
			(room.panels || []).map((panel) => ({
				id: panel.id,
				label: `${room.label || 'Unnamed Room'} - ${panel.label || 'Unnamed Panel'}`,
			})),
		)
		if (panelChoices.length === 0) {
			panelChoices.push({ id: '', label: 'No panels found (or not loaded)' })
		}

		const salvoChoices = []
		for (const panel of this.roomsData.flatMap((room) => room.panels || [])) {
			const salvos = this.panelSalvos[panel.id] || []
			for (const salvo of salvos) {
				salvoChoices.push({
					id: salvo.id,
					label: `${panel.label || 'Unnamed Panel'} - ${salvo.label || 'Unnamed Salvo'}`,
				})
			}
		}
		if (salvoChoices.length === 0) {
			salvoChoices.push({ id: '', label: 'No salvos found (or not loaded)' })
		}

		return {
			run_salvo: {
				name: 'Run Salvo',
				options: [
					{
						type: 'dropdown',
						label: 'Panel',
						id: 'panelId',
						default: panelChoices[0]?.id || '',
						choices: panelChoices,
						minChoicesForSearch: 0,
					},
					{
						type: 'dropdown',
						label: 'Salvo',
						id: 'salvoId',
						default: salvoChoices[0]?.id || '',
						choices: salvoChoices,
						minChoicesForSearch: 0,
						isVisible: (options) => !!options.panelId,
					},
				],
				callback: async (actionEvent) => {
					// Parameter is CompanionActionEvent
					const { panelId, salvoId } = actionEvent.options
					if (salvoId) {
						this.log('debug', `Action: Run salvo ${salvoId} (Panel context: ${panelId})`)
						const result = await this.makeApiRequest('POST', `/salvos/${salvoId}`)
						if (result === true) {
							this.log('info', `Successfully ran salvo: ${salvoId}`)
						} else {
							this.log('warn', `Failed to run salvo: ${salvoId}. Check logs for API errors.`)
						}
					} else {
						this.log('warn', 'Run Salvo action: Salvo ID not selected or not available.')
					}
				},
			},
		}
	}

	getPresets() {
		const presets = []
		const defaultStyle = {
			// Default style for presets defined by Companion
			text: '',
			size: 'auto', // Or specific like '14'
			color: combineRgb(255, 255, 255), // White text
			bgcolor: combineRgb(0, 0, 0), // Black background
		}

		for (const room of this.roomsData) {
			if (room.panels && Array.isArray(room.panels)) {
				for (const panel of room.panels) {
					const salvos = this.panelSalvos[panel.id] || []
					for (const salvo of salvos) {
						presets.push({
							type: 'button',
							category: `${room.label} - ${panel.label || 'Room'}`, // Category for grouping presets
							name: `Run ${salvo.label || 'Unnamed Salvo'} on ${panel.label || 'Panel'}`, // Name visible in preset list
							style: {
								// Button style
								...defaultStyle, // Apply defaults
								text: `$(this:salvo_${salvo.id})`, // Text on the button, \n for new line
							},
							steps: [
								// Steps to execute when button is pressed
								{
									down: [
										// Actions on 'button down'
										{
											actionId: 'run_salvo', // Must match the ID in getActions()
											options: {
												// Options for the action
												panelId: panel.id,
												salvoId: salvo.id,
											},
										},
									],
									up: [], // Actions on 'button up' (optional)
								},
							],
							feedbacks: [], // Feedbacks to apply to this button (optional)
						})
					}
				}
			}
		}
		return presets
	}
}

runEntrypoint(MatroxConductIPInstance, [])
