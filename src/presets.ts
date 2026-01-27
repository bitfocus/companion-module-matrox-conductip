import { CompanionPresetDefinitions } from '@companion-module/base'
import { ConductIPAPI } from './api.js'
import { COLORS } from './utils.js'

export function GetPresets(api: ConductIPAPI): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}
	/* const defaultStyle: CompanionButtonStyleProps = {
		text: '',
		size: 'auto',
		color: COLORS.WHITE,
		bgcolor: COLORS.BLACK,
	} */

	for (const room of api.roomsData) {
		if (room.panels && Array.isArray(room.panels)) {
			for (const panel of room.panels) {
				const salvos = api.panelSalvos[panel.id] || []
				for (const salvo of salvos) {
					presets[`run_salvo_${panel.id}_${salvo.id}`] = {
						type: 'button',
						category: `${room.label} - ${panel.label || 'Room'}`,
						name: `Run ${salvo.label || 'Unnamed Salvo'} on ${panel.label || 'Panel'}`,
						style: {
							color: COLORS.WHITE,
							bgcolor: COLORS.MATROX_BLUE_INACTIVE,
							size: 'auto',
							text: `$(this:salvo_${salvo.id})`,
						},
						steps: [
							{
								down: [
									{
										actionId: 'run_salvo',
										options: {
											panelId: panel.id,
											salvoId: salvo.id,
										},
									},
								],
								up: [],
							},
						],
						feedbacks: [
							{
								feedbackId: 'salvo_active',
								options: {
									salvoId: salvo.id,
								},
								style: {
									color: COLORS.WHITE,
									bgcolor: COLORS.MATROX_BLUE_ACTIVE,
								},
							},
						],
					}
				}
			}
		}
	}
	return presets
}
