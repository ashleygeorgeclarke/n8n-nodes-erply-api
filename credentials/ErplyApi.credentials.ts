import {
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { getSessionAuth } from '../nodes/Erply/GenericFunctions';

export class ErplyApi implements ICredentialType {
	name = 'erplyApi';
	displayName = 'Erply API';
	documentationUrl =
		'https://docs.n8n.io/integrations/creating-nodes/build/declarative-style-node/';

	properties: INodeProperties[] = [
		{
			displayName: 'Client Code',
			name: 'clientCode',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			default: '',
			typeOptions: {
				password: true,
			},
		},
		{
			displayName: 'Use JWT',
			description:
				'Use JWT instead of session key, may cause issues with some endpoints. Required for CDN api',
			name: 'useJwt',
			type: 'boolean',
			default: false,
		},
		{
			displayName: 'Auth proxy',
			description: 'Optional. A full URL for the verifyUser call, returning a session key and jwt',
			name: 'authProxy',
			type: 'string',
			default: '',
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		// has to be run for each request even though sessionKey has an expiry
		// because the expirable property only triggers on a 401 response and erply returns 400
		const { sessionKey, jwt } = await getSessionAuth(credentials);

		// erply.com/api requires creds in the query string, all others (pim etc) are in the header
		let isApiUrl = false;
		//hacky workaround so can be used on any http node
		if (!!requestOptions.url) {
			isApiUrl = requestOptions.url.includes('erply.com/api');
		}

		if (isApiUrl) {
			requestOptions.qs = {
				...requestOptions.qs,
				clientCode: credentials.clientCode,
				sessionKey: sessionKey,
			};
			return requestOptions;
		}

		if (credentials.useJwt) {
			requestOptions.headers = {
				...requestOptions.headers,
				jwt: jwt,
			};
			return requestOptions;
		}

		requestOptions.headers = {
			...requestOptions.headers,
			clientCode: credentials.clientCode,
			sessionKey: sessionKey,
		};
		return {
			...requestOptions,
		};
	}
}
