import { combineRgb } from '@companion-module/base'
import { ConductIPAPI } from './api.js'

export const COLORS = {
	BLACK: combineRgb(0, 0, 0),
	WHITE: combineRgb(255, 255, 255),
	GREEN: combineRgb(66, 89, 242),
	MATROX_BLUE_ACTIVE: combineRgb(66, 89, 242),
	MATROX_BLUE_INACTIVE: combineRgb(32, 39, 53),
}

export function getPanelChoices(api: ConductIPAPI): { id: string; label: string }[] {
	const panelChoices = api.roomsData.flatMap((room) =>
		(room.panels || []).map((panel) => ({
			id: panel.id,
			label: `${room.label || 'Unnamed Room'} - ${panel.label || 'Unnamed Panel'}`,
		})),
	)
	if (panelChoices.length === 0) {
		panelChoices.push({ id: '', label: 'No panels found (or not loaded)' })
	}
	return panelChoices
}

export function getSalvoChoices(api: ConductIPAPI): { id: string; label: string }[] {
	const salvoChoices: { id: string; label: string }[] = []
	//This isn't working in the API rn, no matter what user permissions.
	//salvoChoices.push({ id: 'remove_all_connections', label: 'Remove All Connections' })
	for (const room of api.roomsData) {
		if (room.panels) {
			for (const panel of room.panels) {
				const salvos = api.panelSalvos[panel.id] || []
				for (const salvo of salvos) {
					salvoChoices.push({
						id: salvo.id,
						label: `${panel.label || 'Unnamed Panel'} - ${salvo.label || 'Unnamed Preset'}`,
					})
				}
			}
		}
	}
	if (salvoChoices.length === 0) {
		salvoChoices.push({ id: '', label: 'No presets found (or not loaded)' })
	}
	return salvoChoices
}
