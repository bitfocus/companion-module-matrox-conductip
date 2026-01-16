import { CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import { ConductIPAPI } from './api'

export function GetActions(api: ConductIPAPI): CompanionActionDefinitions {
    const panelChoices = api.roomsData.flatMap((room) =>
        (room.panels || []).map((panel) => ({
            id: panel.id,
            label: `${room.label || 'Unnamed Room'} - ${panel.label || 'Unnamed Panel'}`,
        })),
    )
    if (panelChoices.length === 0) {
        panelChoices.push({ id: '', label: 'No panels found (or not loaded)' })
    }

    const salvoChoices: { id: string; label: string }[] = []
    for (const room of api.roomsData) {
        if (room.panels) {
            for (const panel of room.panels) {
                const salvos = api.panelSalvos[panel.id] || []
                for (const salvo of salvos) {
                    salvoChoices.push({
                        id: salvo.id,
                        label: `${panel.label || 'Unnamed Panel'} - ${salvo.label || 'Unnamed Salvo'}`,
                    })
                }
            }
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
            callback: async (actionEvent: CompanionActionEvent) => {
                const { salvoId } = actionEvent.options as { panelId: string; salvoId: string }
                if (salvoId) {
                    // api.log('debug', `Action: Run salvo ${salvoId} (Panel context: ${panelId})`)
                    // API class doesn't expose log public, but we can assume it works or add logging here if we had access to controller.
                    // Actually api.makeApiRequest handles some logging, but maybe we want specific action logging.
                    // For now, let's just call the API.
                    const result = await api.makeApiRequest('POST', `/salvos/${salvoId}`)
                    if (result === true) {
                        // Success
                    } else {
                        // Error
                    }
                }
            },
        },
    }
}
