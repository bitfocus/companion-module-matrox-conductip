import { ModuleConfig } from './config.js'
import { InstanceStatus, LogLevel } from '@companion-module/base'

export interface Salvo {
	id: string
	label: string
}

export interface Panel {
	id: string
	label: string
	salvos?: Salvo[]
}

export interface Room {
	id: string
	label: string
	panels?: Panel[]
}

export interface ConductIPController {
	config: ModuleConfig
	log(level: LogLevel, message: string): void
	updateStatus(status: InstanceStatus, message?: string | null): void
	updateActions(): void
	updateFeedbacks(): void
	checkFeedbacks(feedbackId: string): void
	updateVariables(): void
	updatePresets(): void
}
