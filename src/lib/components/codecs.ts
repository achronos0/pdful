/**
 * Converters (encoders/decoders)
 *
 * @module
 */

import pako from 'pako'
import { PdfError } from '../core.js'

export namespace codecs {
	export interface StreamFilter {
		name: string,
		decodeParms: { [name: string]: any } | null
	}

	export async function decodeStreamArray (bytes: Uint8Array, filters: StreamFilter[]) {
		for (const filter of filters) {
			switch (filter.name) {
				case 'FlateDecode':
					bytes = pako.inflate(bytes)
					break
				default:
					throw new PdfError(`@TODO: Not supported: Unsupported stream filter ${filter}`, 'parser:not_implemented:stream:filter', { type: 'Stream', notImplemented: true, filter })
			}
		}
		return bytes
	}
}
