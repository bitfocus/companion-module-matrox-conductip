import type { CompanionFeedbackBooleanEvent } from '@companion-module/base'
import { CompanionFeedbackDefinitions } from '@companion-module/base'
import { ConductIPAPI } from './api.js'
import { COLORS, getPanelChoices, getSalvoChoices } from './utils.js'

export function GetFeedbacks(api: ConductIPAPI): CompanionFeedbackDefinitions {
	const feedbacks: CompanionFeedbackDefinitions = {}

	feedbacks.salvo_active = {
		type: 'boolean',
		name: 'Preset Active',
		description: 'The selected preset is active',
		defaultStyle: {
			color: COLORS.WHITE,
			bgcolor: COLORS.MATROX_BLUE_ACTIVE,
		},
		options: [
			{
				type: 'dropdown',
				label: 'Salvo',
				id: 'salvoId',
				default: getSalvoChoices(api)[0]?.id || '',
				choices: getSalvoChoices(api),
				minChoicesForSearch: 0,
			},
		],
		callback: async (feedback: CompanionFeedbackBooleanEvent) => {
			const { salvoId } = feedback.options as { salvoId: string }
			return api.activeSalvos.has(salvoId) || false
		},
	}
	feedbacks.no_connections = {
		type: 'boolean',
		name: 'No Connections',
		description: 'The selected panel has no connections',
		defaultStyle: {
			color: COLORS.WHITE,
			bgcolor: COLORS.MATROX_BLUE_ACTIVE,
		},
		options: [
			{
				type: 'dropdown',
				label: 'Panel',
				id: 'panelId',
				default: getPanelChoices(api)[0]?.id || '',
				choices: getPanelChoices(api),
				minChoicesForSearch: 0,
			},
		],
		callback: async (feedback: CompanionFeedbackBooleanEvent) => {
			const { panelId } = feedback.options as { panelId: string }
			const panelSalvos = api.panelSalvos[panelId] ?? []
			const hasActiveSalvo = panelSalvos.some((s) => api.activeSalvos.has(s.id))
			return !hasActiveSalvo
		},
	}
	return feedbacks
}
