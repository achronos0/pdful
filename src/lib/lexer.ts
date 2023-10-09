/**
 * Lexer is the second stage of parsing
 *
 * It converts document data from tokens into a tree of pdf objects
 *
 * @module
 */

import { PdfObject } from './objects.js'
import { Token } from './tokenizer.js'

interface DocumentRootObject {}

export class Lexer {
	root: DocumentRootObject
	stack: PdfObject[]

	constructor () {
		this.root = {}
		this.stack = []
	}

	pushToken (token: Token) {
		//
	}
}
