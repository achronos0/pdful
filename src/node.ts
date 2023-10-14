/**
 * Import entrypoint for Node.js environment
 *
 * @module
 */

import { codecs, lexer, literals, model, parser, tokenizer } from './main.js'
import { nodeEngine as engine } from './lib/ext/nodeEngine.js'
import { nodeIo as io } from './lib/ext/nodeIo.js'

export function createEngine () {
	return new engine.Engine({ codecs, lexer, literals, io, model, parser, tokenizer })
}

export { codecs, engine, lexer, literals, io, model, parser, tokenizer }
