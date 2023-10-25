/**
 * Node.js extensions to engine component
 *
 * @module
 */

import fs from 'node:fs/promises'
import { engine } from '../components/engine.js'
import type { codecs } from '../components/codecs.js'
import type { literals } from '../components/literals.js'
import type { lexer } from '../components/lexer.js'
import type { nodeIo as io } from './nodeIo.js'
import type { model } from '../components/model.js'
import type { parser } from '../components/parser.js'
import type { structuralizer } from '../components/structuralizer.js'
import type { tokenizer } from '../components/tokenizer.js'

export namespace nodeEngine {
	export class Engine extends engine.Engine {
		io: typeof io

		constructor (config: {
			codecs: typeof codecs,
			literals: typeof literals,
			lexer: typeof lexer,
			io: typeof io,
			model: typeof model,
			parser: typeof parser,
			tokenizer: typeof tokenizer
			structuralizer: typeof structuralizer
		}) {
			super(config)
			this.io = config.io
		}

		async loadDocumentFromFile (config: {
			file: string,
			parserOptions: parser.ParserRunOptions
		}) {
			const file = config.file
			const parserOptions = config.parserOptions
			const fileHandle = await fs.open(file, 'r')
			const reader = await this.io.createReaderFromFileHandle(fileHandle)
			try {
				const document = await this.loadDocumentFromReader({ reader, parserOptions })
				await fileHandle.close()
				return document
			}
			catch (err) {
				await fileHandle.close()
				throw err
			}
		}
	}
}
