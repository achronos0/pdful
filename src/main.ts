/**
 * Import entrypoint
 *
 * @module
 */

import { Constants } from './lib/components/constants.js'
import { Lexer } from './lib/components/lexer.js'
import { Engine } from './lib/components/engine.js'
import { Model } from './lib/components/model.js'
import { Reader } from './lib/components/reader.js'
import { Parser } from './lib/components/parser.js'
import { Tokenizer } from './lib/components/tokenizer.js'

export function createEngine () {
	return new Engine({ Constants, Lexer, Model, Reader, Parser, Tokenizer })
}
