
import fs from 'node:fs/promises'
import { createEngine } from '../node.js'
import { PrintObjTreeOptions, printObjTree } from '../lib/debug.js'
import type { parser } from '../lib/components/parser.js'

// Constants
const INPUT_NUMBER = 6
const INPUT_FILE = `input/${INPUT_NUMBER}.pdf`
const INPUT_USE_BUFFER = false
const ABORT_ON_WARNING = true
const PRINT_STRUCTURE = true
const PRINT_ROOT_OBJ = false
const PRINT_CATALOG_OBJ = false
const PRINT_OBJ_OPTIONS: PrintObjTreeOptions = {
	maxDepth: 8
}
const PRINT_TOKENS = false
const PRINT_LEXER = false
const PRINT_WARNINGS: boolean | 'first' | 'detail' = 'detail'

async function run () {
	// Setup parser options
	const parserOptions: parser.ParserRunOptions = {}
	if (ABORT_ON_WARNING) {
		parserOptions.abortOnWarning = true
	}
	if (PRINT_TOKENS) {
		parserOptions.onToken = token => {
			const args: any[] = [token.type, token.start]
			if (token.warning) {
				args.push(token.warning.message)
			}
			console.log('token', ...args)
		}
	}
	if (PRINT_LEXER) {
		parserOptions.onLexer = (obj, warnings) => {
			const args: any[] = [obj ? obj.type : undefined]
			if (warnings.length) {
				args.push(...warnings.map(err => err.message))
			}
			console.log('lexer', ...args)
		}
	}

	// Init components
	const engine = createEngine()

	// Load document
	let document
	if (INPUT_USE_BUFFER) {
		const buffer = await fs.readFile(INPUT_FILE)
		const bytes = Uint8Array.from(buffer)
		document = await engine.loadDocumentFromArray({ bytes, parserOptions })
	}
	else {
		document = await engine.loadDocumentFromFile({ file: INPUT_FILE, parserOptions })
	}

	// Report results
	console.log('pdfVersion: ', document.store.pdfVersion)
	if (PRINT_STRUCTURE) {
		console.log(document.structure)
	}
	if (PRINT_ROOT_OBJ) {
		printObjTree(document.store.root, PRINT_OBJ_OPTIONS)
	}
	if (PRINT_CATALOG_OBJ) {
		if (document.store.catalog) {
			printObjTree(document.store.catalog, PRINT_OBJ_OPTIONS)
		}
		else {
			console.warn('No catalog object')
		}
	}
	if (document.parserWarnings.length) {
		console.error(`Parser warnings: ${document.parserWarnings.length} warnings`)
		if (PRINT_WARNINGS === 'first') {
			console.error(1, document.parserWarnings[0])
		}
		else if (PRINT_WARNINGS === 'detail') {
			for (const [index, err] of document.parserWarnings.entries()) {
				console.error(index + 1, err)
			}
		}
		else if (PRINT_WARNINGS) {
			const messageMap: {[message: string]: number} = {}
			for (const err of document.parserWarnings.values()) {
				const message = err.message
				if (messageMap[message]) {
					messageMap[message]++
				}
				else {
					messageMap[message] = 1
				}
			}
			const messages = Object.keys(messageMap)
			messages.sort()
			for (const [index, message] of messages.entries()) {
				const count = messageMap[message]
				if (count > 1) {
					console.error(index + 1, `${message} [x ${count}]`)
				}
				else {
					console.error(index + 1, message)
				}
			}
		}
	}
}

try {
	await run()
}
catch (err) {
	console.error('ERROR:', err)
}

/*
	\n " "
		space
	"%" ... \n
		space_comment
	"null"
		obj_null
	"true"
	"false"
		obj_boolean
	1
	+1
	-1
	1.1
	-1.1
	+1.1
	1.
	.1
		obj_number
	"(" str ")"
		obj_string
	"<" hex ">"
		obj_hexstring
	"\"name
		obj_name
	"[" {obj} {obj} ... "]"
		obj_array
	<< {\obj_name} {obj} {\obj_name} {obj} ... >>
		obj_dictionary
	{obj_dictionary} stream\n ... \nendstream\n
		obj_stream
	{obj_number} {obj_number} "obj" {obj} "endobj"
		obj_indirect
	{obj_number} {obj_number} "R"
		obj_ref
*/
