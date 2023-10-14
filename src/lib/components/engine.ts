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
		constants: literals.Constants

		constructor (config: {
			codecs: typeof codecs,
			literals: typeof literals,
			lexer: typeof lexer,
			io: typeof io,
			model: typeof model,
			parser: typeof parser,
			tokenizer: typeof tokenizer
		}) {
			this.codecs = config.codecs
			this.literals = config.literals
			this.lexer = config.lexer
			this.model = config.model
			this.io = config.io
			this.parser = config.parser
			this.tokenizer = config.tokenizer
			this.constants = config.literals.Constants.create()
		}
	}
}
