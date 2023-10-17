
import fs from 'node:fs/promises'
import { createEngine, io } from '../node.js'
import { PrintObjTreeOptions, printObjTree } from '../lib/debug.js'
import type { parser } from '../lib/components/parser.js'

// Constants
const INPUT_FILE = 'input/2.pdf'
const INPUT_USE_BUFFER = false
const ABORT_ON_WARNING = true
const PRINT_ROOT_OBJ = false
const PRINT_CATALOG_OBJ = true
const PRINT_OBJ_OPTIONS: PrintObjTreeOptions = {
	maxDepth: 8
}
const PRINT_TOKENS = false
const PRINT_LEXER = false
const PRINT_WARNINGS: boolean | 'first' | 'detail' = 'detail'

async function run () {
	// Init components
	const engine = createEngine()
	const parser = new engine.parser.Parser({ engine })

	// Init reader
	let reader: io.ReaderPair
	if (INPUT_USE_BUFFER) {
		const buffer = await fs.readFile(INPUT_FILE)
		const bytes = Uint8Array.from(buffer)
		reader = engine.io.createReaderFromArray(bytes)
	}
	else {
		const fileHandle = await fs.open(INPUT_FILE, 'r')
		reader = await engine.io.createReaderFromFileHandle(fileHandle)
	}

	// Parse
	const options: parser.ParserRunOptions = {}
	if (ABORT_ON_WARNING) {
		options.abortOnWarning = true
	}
	if (PRINT_TOKENS) {
		options.onToken = token => {
			const args: any[] = [token.type, token.start]
			if (token.warning) {
				args.push(token.warning.message)
			}
			console.log('token', ...args)
		}
	}
	if (PRINT_LEXER) {
		options.onLexer = (obj, warnings) => {
			const args: any[] = [obj ? obj.type : undefined]
			if (warnings.length) {
				args.push(...warnings.map(err => err.message))
			}
			console.log('lexer', ...args)
		}
	}
	const { pdfVersion, collection, warnings } = await parser.run({ reader, options })

	// Report results
	console.log('pdfVersion: ', pdfVersion)
	if (PRINT_ROOT_OBJ) {
		printObjTree(collection.root, PRINT_OBJ_OPTIONS)
	}
	if (PRINT_CATALOG_OBJ) {
		if (collection.catalog) {
			printObjTree(collection.catalog, PRINT_OBJ_OPTIONS)
		}
		else {
			console.warn('No catalog object')
		}
	}
	if (warnings.length) {
		console.error(`Parser warnings: ${warnings.length} warnings`)
		if (PRINT_WARNINGS === 'first') {
			console.error(1, warnings[0])
		}
		else if (PRINT_WARNINGS === 'detail') {
			for (const [index, err] of warnings.entries()) {
				console.error(index + 1, err)
			}
		}
		else if (PRINT_WARNINGS) {
			for (const [index, err] of warnings.entries()) {
				console.error(index + 1, err.message)
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
