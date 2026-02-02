import { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import { ConductIPAPI } from './api.js'

export function GetVariables(api: ConductIPAPI): CompanionVariableDefinition[] {
	const variables: CompanionVariableDefinition[] = []

	// Add panel variables
	for (const room of api.roomsData) {
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
	for (const panelId in api.panelSalvos) {
		const salvos = api.panelSalvos[panelId]
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

export function GetVariableValues(api: ConductIPAPI): CompanionVariableValues {
	const variableValues: CompanionVariableValues = {}

	// Set panel variable values
	for (const room of api.roomsData) {
		if (room.panels && Array.isArray(room.panels)) {
			for (const panel of room.panels) {
				variableValues[`panel_${panel.id}`] = panel.label || 'Unnamed Panel'
			}
		}
	}

	// Set salvo variable values
	for (const panelId in api.panelSalvos) {
		const salvos = api.panelSalvos[panelId]
		if (Array.isArray(salvos)) {
			for (const salvo of salvos) {
				variableValues[`salvo_${salvo.id}`] = salvo.label || 'Unnamed Salvo'
			}
		}
	}

	return variableValues
}
