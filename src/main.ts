import { InstanceBase, runEntrypoint, InstanceStatus, SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, ModuleConfig } from './config.js'
import { ConductIPAPI } from './api.js'
import { GetActions } from './actions.js'
import { GetPresets } from './presets.js'
import { GetVariables, GetVariableValues } from './variables.js'
import { ConductIPController } from './types.js'
import { GetFeedbacks } from './feedbacks.js'

class MatroxConductIPInstance extends InstanceBase<ModuleConfig> implements ConductIPController {
	public config: ModuleConfig = {}
	private api: ConductIPAPI

	constructor(internal: unknown) {
		super(internal)
		this.api = new ConductIPAPI(this)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting, 'Initializing...')

		this.api.configureHttpsAgent()

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariables()

		if (this.config.host && this.config.username && this.config.password) {
			await this.api.fetchInitialData()
			this.api.setupPolling(true)
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration: IP/Host, Username, or Password')
			this.api.setupPolling(false)
		}
	}

	async destroy() {
		await this.api.destroy()
		this.log('debug', 'Destroyed')
	}

	async configUpdated(config: ModuleConfig) {
		this.config = config

		await this.api.destroy() // Stop polling

		this.api.configureHttpsAgent()

		if (this.config.host && this.config.username && this.config.password) {
			// We don't need to re-create variables/actions immediately if structure hasn't changed,
			// but fetching data will trigger updates.
			await this.api.fetchInitialData()
			this.api.setupPolling(true)
		} else {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing configuration')
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		this.setActionDefinitions(GetActions(this.api))
	}
	updateFeedbacks(): void {
		this.setFeedbackDefinitions(GetFeedbacks(this.api))
	}

	updateVariables(): void {
		this.setVariableDefinitions(GetVariables(this.api))
		this.setVariableValues(GetVariableValues(this.api))
	}

	updatePresets(): void {
		this.setPresetDefinitions(GetPresets(this.api))
	}
}

runEntrypoint(MatroxConductIPInstance, [])
