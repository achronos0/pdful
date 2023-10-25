/**
 * Manage PDF engine
 *
 * @module
 */

import type { codecs } from './codecs.js'
import type { literals } from './literals.js'
import type { lexer } from './lexer.js'
import type { io } from './io.js'
import type { model } from './model.js'
import type { parser } from './parser.js'
import type { structuralizer } from './structuralizer.js'
import type { tokenizer } from './tokenizer.js'

export namespace engine {
	export class Engine {
		codecs: typeof codecs
		literals: typeof literals
		lexer: typeof lexer
		io: typeof io
		model: typeof model
		parser: typeof parser
		tokenizer: typeof tokenizer
		structuralizer: typeof structuralizer
		constants: literals.Constants

		constructor (config: {
			codecs: typeof codecs
			literals: typeof literals
			lexer: typeof lexer
			io: typeof io
			model: typeof model
			parser: typeof parser
			structuralizer: typeof structuralizer
			tokenizer: typeof tokenizer
		}) {
			this.codecs = config.codecs
			this.literals = config.literals
			this.lexer = config.lexer
			this.model = config.model
			this.io = config.io
			this.parser = config.parser
			this.structuralizer = config.structuralizer
			this.tokenizer = config.tokenizer
			this.constants = config.literals.Constants.create()
		}

		async loadDocumentFromArray (config: {
			bytes: Uint8Array
			parserOptions: parser.ParserRunOptions
		}) {
			const bytes = config.bytes
			const parserOptions = config.parserOptions
			const reader = this.io.createReaderFromArray(bytes)
			return await this.loadDocumentFromReader({ reader, parserOptions })
		}

		async loadDocumentFromReader (config: {
			reader: io.ReaderPair
			parserOptions: parser.ParserRunOptions
		}) {
			const reader = config.reader
			const parserOptions = config.parserOptions

			const parser = new this.parser.Parser({ engine: this })
			const {
				store: store,
				warnings: parserWarnings
			} = await parser.run({
				reader,
				options: parserOptions
			})

			const structuralizer = new this.structuralizer.Structuralizer({ engine: this })
			const {
				structure,
				warnings: structuralizerWarnings
			} = structuralizer.run({ store })

			const document = new this.model.Document({
				store,
				parserWarnings,
				structure,
				structuralizerWarnings
			})

			return document
		}
	}
}
