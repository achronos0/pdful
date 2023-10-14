/**
 * Import entrypoint for generic environment (i.e. browser)
 *
 * @module
 */

import { codecs } from './lib/components/codecs.js'
import { engine } from './lib/components/engine.js'
import { lexer } from './lib/components/lexer.js'
import { literals } from './lib/components/literals.js'
import { io } from './lib/components/io.js'
import { model } from './lib/components/model.js'
import { parser } from './lib/components/parser.js'
import { tokenizer } from './lib/components/tokenizer.js'

export function createEngine () {
	return new engine.Engine({ codecs, lexer, literals, io, model, parser, tokenizer })
}

export { codecs, engine, lexer, literals, io, model, parser, tokenizer }
