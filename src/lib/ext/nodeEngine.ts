/**
 * Node.js extensions to engine component
 *
 * @module
 */

import { engine } from '../components/engine.js'
import type { codecs } from '../components/codecs.js'
import type { literals } from '../components/literals.js'
import type { lexer } from '../components/lexer.js'
import type { nodeIo as io } from './nodeIo.js'
import type { model } from '../components/model.js'
import type { parser } from '../components/parser.js'
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
		}) {
			super(config)
			this.io = config.io
		}
	}
}
