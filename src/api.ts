import { InstanceStatus } from '@companion-module/base'
import { Buffer } from 'buffer'
import https from 'https'
import { ConductIPController, Room, Salvo } from './types.js'

const API_TIMEOUT = 5000 // 5 seconds timeout for API requests
const POLLING_INTERVAL = 1000 // 1 second interval for polling rooms/panels
const ERROR_POLLING_INTERVAL = 5000 // 5 second interval for polling rooms/panels when there is an error

export class ConductIPAPI {
	private controller: ConductIPController
	public roomsData: Room[] = []
	public panelSalvos: { [panelId: string]: Salvo[] } = {}
	public activeSalvos: Set<string> = new Set()
	private pollTimer: NodeJS.Timeout | null = null
	private customHttpsAgent: https.Agent | undefined = undefined
	private connectionErrorLogged: boolean = false

	constructor(controller: ConductIPController) {
		this.controller = controller
	}

	public configureHttpsAgent(): void {
		if (this.controller.config.allowUnauthorized) {
			// Create new agent only if not already created with correct setting
			if (
				!this.customHttpsAgent ||
				(this.customHttpsAgent && (this.customHttpsAgent as any).options.rejectUnauthorized !== false)
			) {
				this.customHttpsAgent = new https.Agent({
					rejectUnauthorized: false,
				})
				this.controller.log('debug', 'Custom HTTPS agent configured to ALLOW unverified certificates.')
			}
		} else {
			// Revert to default (undefined means use Node's default https.globalAgent)
			if (this.customHttpsAgent) {
				// only change if it was previously custom
				this.customHttpsAgent = undefined
				this.controller.log('debug', 'HTTPS agent configured to VERIFY certificates (default).')
			}
		}
	}

	public async destroy(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		this.customHttpsAgent = undefined
	}

	public async makeApiRequest(method: string, endpoint: string, requestBodyObj: any = null): Promise<any> {
		if (!this.controller.config.host || !this.controller.config.username || !this.controller.config.password) {
			this.controller.updateStatus(InstanceStatus.BadConfig, 'Configuration is incomplete.')
			return null // Return null directly
		}

		const upperMethod = method.toUpperCase()
		let bodyString: string | null = null

		if ((upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'DELETE') && requestBodyObj !== null) {
			try {
				bodyString = JSON.stringify(requestBodyObj)
			} catch (e: any) {
				this.controller.log('error', `Failed to stringify request body: ${e.message}`)
				this.controller.updateStatus(InstanceStatus.UnknownError, 'Invalid request body') // Fixed from ModuleError
				return null
			}
		}

		return new Promise((resolve) => {
			const options: https.RequestOptions = {
				hostname: this.controller.config.host,
				port: 443, // Default HTTPS port
				path: `/api${endpoint}`,
				method: upperMethod,
				headers: {
					Authorization: `Basic ${Buffer.from(`${this.controller.config.username}:${this.controller.config.password}`).toString('base64')}`,
					'User-Agent': `Companion-Module/matrox-conductip`,
				},
				timeout: API_TIMEOUT, // in milliseconds
			}

			if (this.customHttpsAgent) {
				options.agent = this.customHttpsAgent
			}

			if (options.headers) {
				const headers = options.headers as any // Fixed typing
				if (bodyString) {
					headers['Content-Type'] = 'application/json'
					headers['Content-Length'] = Buffer.byteLength(bodyString)
				} else if (upperMethod === 'POST' || upperMethod === 'PUT') {
					headers['Content-Length'] = 0 // For empty POST/PUT bodies
				}
			}

			const req = https.request(options, (res) => {
				let responseData = ''
				res.setEncoding('utf8')

				res.on('data', (chunk) => {
					responseData += chunk
				})

				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						// Connection successful - reset error logging flag
						this.connectionErrorLogged = false
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
							resolve(null)
							return
						}
						try {
							const jsonData = JSON.parse(responseData)
							resolve(jsonData)
						} catch (e: any) {
							this.controller.log(
								'warn',
								`Failed to parse JSON response from ${endpoint}: ${e.message}. Raw: "${responseData}"`,
							)
							this.controller.updateStatus(InstanceStatus.UnknownError, 'Failed to parse API response')
							resolve(null)
						}
					} else {
						const userFriendlyMessage = `API Error ${res.statusCode}`
						this.controller.log(
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
						}

						this.controller.updateStatus(statusToSet, detailedMessage)
						resolve(null)
					}
				})
			})

			req.on('timeout', () => {
				req.destroy()
				if (!this.connectionErrorLogged) {
					const timeoutMessage = `Request to ${options.hostname}${options.path} timed out after ${API_TIMEOUT}ms`
					this.controller.log('warn', timeoutMessage)
					this.connectionErrorLogged = true
				}
				this.controller.updateStatus(InstanceStatus.ConnectionFailure, 'Request Timeout')
				resolve(null)
			})

			req.on('error', (e: any) => {
				if (!this.connectionErrorLogged) {
					this.controller.log('warn', `HTTP Request to ${options.hostname}${options.path} failed: ${e.message}`)
					this.connectionErrorLogged = true
				}
				let userMessage = `Request failed: ${e.code || e.message}`

				if (e.code === 'ECONNREFUSED') {
					userMessage = 'Connection refused'
				} else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
					userMessage = 'Host not found or DNS lookup failure'
				} else if (e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || e.message.toLowerCase().includes('certificate')) {
					if (!this.controller.config.allowUnauthorized) {
						userMessage = 'Certificate validation error. Try "Allow Unverified Certificates".'
					} else {
						userMessage = `SSL Certificate error (even with bypass): ${e.message}`
					}
				}
				this.controller.updateStatus(InstanceStatus.ConnectionFailure, userMessage)
				resolve(null)
			})

			if (bodyString) {
				req.write(bodyString)
			}
			req.end()
		})
	}

	public setupPolling(ok: boolean = true): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		if (this.controller.config.host && this.controller.config.username && this.controller.config.password) {
			this.pollTimer = setInterval(
				() => {
					this.fetchRoomsAndPanels().catch(() => {
						// Error handling is done inside fetchRoomsAndPanels
					})
				},
				ok ? POLLING_INTERVAL : ERROR_POLLING_INTERVAL,
			)
			this.controller.log('debug', 'Polling started.')
		} else {
			this.controller.log('debug', 'Polling not started due to missing config.')
		}
	}

	public async fetchInitialData(): Promise<void> {
		this.controller.log('debug', 'Fetching initial data...')
		await this.fetchRoomsAndPanels()
	}

	private areRoomsEqual(rooms1: Room[], rooms2: Room[]): boolean {
		if (rooms1.length !== rooms2.length) {
			return false
		}
		return JSON.stringify(rooms1) === JSON.stringify(rooms2)
	}

	private arePanelSalvosEqual(
		salvos1: { [panelId: string]: Salvo[] },
		salvos2: { [panelId: string]: Salvo[] },
	): boolean {
		const keys1 = Object.keys(salvos1).sort()
		const keys2 = Object.keys(salvos2).sort()
		if (keys1.length !== keys2.length) {
			return false
		}
		for (let i = 0; i < keys1.length; i++) {
			if (keys1[i] !== keys2[i]) {
				return false
			}
			// Compare salvo arrays for each panel
			if (JSON.stringify(salvos1[keys1[i]]) !== JSON.stringify(salvos2[keys2[i]])) {
				return false
			}
		}
		return true
	}

	private areActiveSalvosEqual(active1: Set<string>, active2: Set<string>): boolean {
		if (active1.size !== active2.size) {
			return false
		}
		for (const id of active1) {
			if (!active2.has(id)) {
				return false
			}
		}
		return true
	}

	public async fetchRoomsAndPanels(): Promise<void> {
		if (!this.controller.config.host || !this.controller.config.username || !this.controller.config.password) {
			return
		}
		// this.log('debug',"Fetching rooms and panels...")
		const roomsInfo = await this.makeApiRequest('GET', '/rooms/info')
		this.controller.log('debug', `Fetched rooms/panels data: ${JSON.stringify(roomsInfo)}`)

		if (roomsInfo && Array.isArray(roomsInfo)) {
			const newRoomsData = roomsInfo as Room[]
			this.controller.updateStatus(InstanceStatus.Ok)

			// Extract salvos directly from panels in the response
			const newPanelSalvos: { [panelId: string]: Salvo[] } = {}
			for (const room of newRoomsData) {
				if (room.panels && Array.isArray(room.panels)) {
					for (const panel of room.panels) {
						// Salvos are now embedded in the panel data from /rooms/info
						if (panel.salvos && Array.isArray(panel.salvos)) {
							newPanelSalvos[panel.id] = panel.salvos
						} else {
							// Handle case where salvos might be missing (empty array)
							newPanelSalvos[panel.id] = []
						}
					}
				}
			}

			// Check if rooms data has changed
			const roomsChanged = !this.areRoomsEqual(this.roomsData, newRoomsData)
			// Check if panel salvos have changed
			const panelSalvosChanged = !this.arePanelSalvosEqual(this.panelSalvos, newPanelSalvos)

			// Update stored data
			this.roomsData = newRoomsData
			this.panelSalvos = newPanelSalvos

			// Fetch active salvos and check if they changed
			const activeSalvosChanged = await this.fetchActiveSalvos()

			// Only update if any data has changed
			if (roomsChanged || panelSalvosChanged || activeSalvosChanged) {
				if (roomsChanged || panelSalvosChanged) {
					// Rooms/panels/salvos structure changed - update actions, presets, and variables
					this.controller.updateActions()
					this.controller.updatePresets()
					this.controller.updateVariables()
				}
				// Active salvos changed - update feedbacks
				if (activeSalvosChanged) {
					this.controller.updateFeedbacks()
				}
			}
		} else if (roomsInfo === null) {
			// makeApiRequest failed, status already set and logged.
			this.controller.log('debug', 'Polling: Failed to fetch rooms/panels, makeApiRequest returned null.')
		} else {
			// Data received but not in expected array format
			this.controller.log(
				'warn',
				`fetchRoomsAndPanels: Received invalid data format. Expected array, got: ${JSON.stringify(roomsInfo)}`,
			)
			this.controller.updateStatus(InstanceStatus.UnknownWarning, 'Invalid data format from API (rooms)')
		}
	}

	async fetchSalvosForPanel(panelId: string): Promise<Salvo[]> {
		if (!panelId) {
			this.controller.log('error', 'fetchSalvosForPanel called with no panelId')
			return [] // Return empty array to prevent issues
		}
		// this.log('debug',`Fetching salvos for panel ${panelId}...`)
		const panelInfo = await this.makeApiRequest('GET', `/panels/info/${panelId}`)
		if (panelInfo?.salvos && Array.isArray(panelInfo.salvos)) {
			return panelInfo.salvos
		}

		if (panelInfo === null) {
			// makeApiRequest failed and returned null, status handled there.
			this.controller.log('warn', `Failed to fetch salvos for panel ${panelId} as API request failed.`)
			return []
		}

		this.controller.log(
			'warn',
			`Invalid data format for panel ${panelId} salvos. Expected 'salvos' array. Got: ${JSON.stringify(panelInfo)}`,
		)

		this.controller.updateStatus(InstanceStatus.UnknownWarning, `Invalid data for panel ${panelId}`)
		return []
	}

	async fetchActiveSalvos(): Promise<boolean> {
		const activeSalvosInfo = await this.makeApiRequest('GET', '/salvos/active')
		const oldActiveSalvos = new Set(this.activeSalvos)
		if (activeSalvosInfo && Array.isArray(activeSalvosInfo)) {
			this.activeSalvos = new Set(activeSalvosInfo.map((salvo: Salvo) => salvo.id))
			this.controller.log('debug', `Fetched active salvos: ${Array.from(this.activeSalvos).join(', ')}`)
		} else if (activeSalvosInfo === null) {
			this.controller.log('debug', 'Polling: Failed to fetch active salvos, makeApiRequest returned null.')
			// Clear active salvos on failure
			this.activeSalvos = new Set()
		} else {
			this.controller.log('warn', `Received invalid data format for active salvos. ${JSON.stringify(activeSalvosInfo)}`)
			// Clear active salvos on invalid data
			this.activeSalvos = new Set()
		}
		// Check if active salvos changed
		const changed = !this.areActiveSalvosEqual(oldActiveSalvos, this.activeSalvos)
		// Only check feedbacks if active salvos changed
		if (changed) {
			this.controller.checkFeedbacks('salvo_active')
		}
		return changed
	}
}
