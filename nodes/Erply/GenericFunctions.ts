import {
	IDataObject,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
	NodeApiError,
	NodeOperationError,
	IHttpRequestOptions,
	ICredentialDataDecryptedObject,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
} from 'n8n-workflow';
import axios from 'axios';

import jmespath from 'jmespath';

interface SessionCache {
	sessionKey: string;
	jwt: string;
	expiresAt: number;
}

let sessionCache: Record<string, SessionCache> = {};

//turns various data responses into either an object or array of objects
export async function servicePostReceiveTransform(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	_response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const jmesPath = this.getNodeParameter('jmesPath') as string;
	const fullResponse = this.getNodeParameter('includeHeaders') as boolean;

	if (!jmesPath && !fullResponse) {
		return items;
	}

	if (!jmesPath && fullResponse) {
		return [
			{
				json: {
					headers: _response.headers,
					body: _response.body,
				},
			},
		];
	}

	const body = _response.body as IDataObject;

	const retRaw = jmespath.search(body, jmesPath);

	if (fullResponse) {
		return [
			{
				json: {
					headers: _response.headers,
					body: retRaw,
				},
			},
		];
	}

	const isObject = typeof retRaw === 'object' && !Array.isArray(retRaw) && retRaw !== null;
	const isArray = Array.isArray(retRaw);

	if (isObject) {
		return [
			{
				json: retRaw,
			},
		];
	}

	if (isArray) {
		return retRaw.map((item: IDataObject) => {
			return {
				json: item,
			} as INodeExecutionData;
		});
	}

	return items;
}

export async function getServiceEndpoints(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const creds = await this.getCredentials('erplyApi');

	const res = await this.helpers.httpRequest({
		url: `https://${creds.clientCode}.erply.com/api`,
		method: 'POST',
		qs: {
			request: 'getServiceEndpoints',
			clientCode: creds.clientCode,
		},
	});

	if (res.status.errorCode != 0) {
		throw new NodeOperationError(this.getNode(), 'Error');
	}

	const ret = Object.keys(res.records[0]).map((key) => {
		return {
			name: key,
			value: res.records[0][key].url,
		};
	});
	return ret;
}

export async function getEndpointPaths(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const endpointPath = this.getNodeParameter('service', null, {
		extractValue: true,
	}) as any;

	const res = await this.helpers.httpRequest({
		url: endpointPath + 'documentation/doc.json',
		method: 'GET',
	});

	const ret = Object.keys(res.paths).map((key) => {
		return {
			name: key,
			value: key,
		};
	});
	return ret;
}

export async function getSessionAuth(credentials: ICredentialDataDecryptedObject): Promise<any> {
	const cacheKey = `${credentials.clientCode}:${credentials.username}`;
	const now = Date.now();

	// Check if we have a valid cached session
	if (sessionCache[cacheKey] && sessionCache[cacheKey].expiresAt > now) {
		return {
			sessionKey: sessionCache[cacheKey].sessionKey,
			jwt: sessionCache[cacheKey].jwt,
		};
	}

	// If not cached or expired, authenticate
	let url;
	if (credentials.authProxy) {
		url = credentials.authProxy as string;
	} else {
		url = encodeURI(`https://${credentials.clientCode}.erply.com/api?clientCode=${credentials.clientCode}&username=${credentials.username}&password=${credentials.password}&request=verifyUser&doNotGenerateIdentityToken=1`)
	}

	let authResp;
	try {
		authResp = await axios.get(url, {
			auth: {
				username: credentials.username as string,
				password: credentials.password as string,
			},
		});
	} catch (error) {
		throw new Error('Could not authenticate', {
			cause: error,
		});
	}

	if (authResp.status !== 200) {
		throw new Error('Could not authenticate');
	}

	// Cache the session for 45 minutes (Erply sessions typically last 1 hour)
	sessionCache[cacheKey] = {
		sessionKey: authResp.data.records[0].sessionKey,
		jwt: authResp.data.records[0].token,
		expiresAt: now + 45 * 60 * 1000,
	};

	return {
		sessionKey: sessionCache[cacheKey].sessionKey,
		jwt: sessionCache[cacheKey].jwt,
	};
}

export async function apiWebhookRequest(
	this: IHookFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject,
): Promise<any> {
	const baseUrl = this.getNodeParameter('baseUrl');

	const opts: IHttpRequestOptions = {
		url: `${baseUrl}${endpoint}`,
		method,
		body,
	};

	if (Object.keys(body).length === 0) {
		delete opts.body;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'erplyApi', opts);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}
