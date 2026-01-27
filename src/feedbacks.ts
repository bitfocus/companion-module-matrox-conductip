import type { CompanionFeedbackBooleanEvent } from '@companion-module/base'
import { CompanionFeedbackDefinitions } from '@companion-module/base'
import { ConductIPAPI } from './api.js'
import { COLORS, getSalvoChoices } from './utils.js'

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
	return feedbacks
}
