import { Regex, SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	host?: string
	username?: string
	password?: string
	allowUnauthorized?: boolean
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'Make sure to assign at least one room and panel to the user you use specify below.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'ConductIP IP/Hostname',
			width: 12,
			regex: Regex.HOSTNAME,
			required: true,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
			required: true,
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Password',
			width: 6,
			required: true,
		},
		{
			type: 'checkbox',
			id: 'allowUnauthorized',
			label: 'Allow Unverified/Self-Signed HTTPS Certificates',
			width: 12,
			default: false,
			tooltip: 'Set to true if your ConductIP device uses a self-signed HTTPS certificate.',
		},
	]
}
