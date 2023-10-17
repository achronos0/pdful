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
	export type StreamFilterName = 'FlateDecode'
	export type StringEncoding = 'latin1' | 'utf16be' | 'utf8'

	export async function decodeStreamArray (bytes: Uint8Array, filters: StreamFilter[]) {
		for (const filter of filters) {
			try {
				switch (filter.name) {
					case 'FlateDecode':
						bytes = pako.inflate(bytes)
						if (!bytes) {
							throw new PdfError(`inflate returned ${typeof bytes}`, 'decoder:error:stream_filter:FlateDecode')
						}
						break
					default:
						throw new PdfError(`@TODO: Not supported: Unsupported stream filter ${filter.name}`, `decoder:not_implemented:stream_filter:${filter.name}`, { type: 'Stream', notImplemented: true, filter })
				}
			}
			catch (err) {
				if (err instanceof PdfError) {
					throw err
				}
				let errObj: Error
				if (err instanceof Error) {
					errObj = err
				}
				else {
					errObj = new Error(String(err))
				}
				const finalErr = new PdfError(`Decoder error (${filter.name}): ${errObj.message}`, `decoder:error:stream_filter:${filter.name}`)
				finalErr.cause = errObj
				throw finalErr
			}
		}
		return bytes
	}

	const stringDecoders = {
		latin1: new TextDecoder('latin1'),
		utf16be: new TextDecoder('utf-16be'),
		utf8: new TextDecoder('utf-8')
	}

	export function decodeStringArray (bytes: Uint8Array, encoding: StringEncoding) {
		return stringDecoders[encoding].decode(Uint8Array.from(bytes))
	}
}
