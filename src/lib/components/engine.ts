/**
 * Manage PDF engine
 */

import type { Constants } from './constants.js'
import type { Lexer } from './lexer.js'
import type { Model } from './model.js'
import type { Reader } from './reader.js'
import type { Parser } from './parser.js'
import type { Tokenizer } from './tokenizer.js'

export class Engine {
	Lexer: typeof Lexer
	Model: typeof Model
	Reader: typeof Reader
	Parser: typeof Parser
	Tokenizer: typeof Tokenizer
	constants: Constants

	constructor (config: {
		Constants: typeof Constants,
		Lexer: typeof Lexer,
		Model: typeof Model,
		Reader: typeof Reader,
		Parser: typeof Parser,
		Tokenizer: typeof Tokenizer
	}) {
		this.Lexer = config.Lexer
		this.Model = config.Model
		this.Reader = config.Reader
		this.Parser = config.Parser
		this.Tokenizer = config.Tokenizer
		this.constants = config.Constants.create()
	}
}
