import { CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import { ConductIPAPI } from './api.js'
import { getPanelChoices, getSalvoChoices } from './utils.js'

export function GetActions(api: ConductIPAPI): CompanionActionDefinitions {
	return {
		run_salvo: {
			name: 'Take Preset',
			options: [
				{
					type: 'dropdown',
					label: 'Panel',
					id: 'panelId',
					default: getPanelChoices(api)[0]?.id || '',
					choices: getPanelChoices(api),
					minChoicesForSearch: 0,
				},
				{
					type: 'dropdown',
					label: 'Preset',
					id: 'salvoId',
					default: getSalvoChoices(api)[0]?.id || '',
					choices: getSalvoChoices(api),
					minChoicesForSearch: 0,
					isVisible: (options) => !!options.panelId,
				},
			],
			callback: async (actionEvent: CompanionActionEvent) => {
				const { panelId, salvoId } = actionEvent.options as { panelId: string; salvoId: string }
				if (salvoId === 'remove_all_connections') {
					const result = await api.makeApiRequest('DELETE', `/panels/${panelId}/connections`)
					if (result === true) {
						// Success
					} else {
						// Error
					}
				} else if (salvoId) {
					const result = await api.makeApiRequest('POST', `/salvos/${salvoId}`)
					if (result === true) {
						await api.fetchActiveSalvos()
						// Success
					} else {
						// Error
					}
				}
			},
		},
	}
}
