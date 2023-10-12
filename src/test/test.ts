
import fs from 'node:fs/promises'
import { createEngine } from '../main.js'
import { PrintObjectTreeOptions, printObjectTree } from '../lib/debug.js'
import type { Reader } from '../lib/components/reader.js'

// Constants
const TEST_FILE = 'input/1.pdf'
const TEST_BUFFER = false
const PRINT_OBJECTS = false
const PRINT_OBJECTS_OPTIONS: PrintObjectTreeOptions = {
	maxDepth: 4
}

// Init components
const engine = createEngine()
const parser = new engine.Parser({ engine })

// Init reader
let reader: Reader.ReaderPair
if (TEST_BUFFER) {
	const buffer = await fs.readFile(TEST_FILE)
	const bytes = Uint8Array.from(buffer)
	reader = engine.Reader.createReaderFromArray(bytes)
}
else {
	const fileHandle = await fs.open(TEST_FILE, 'r')
	reader = await engine.Reader.createReaderFromFileHandle(fileHandle)
}

// Parse
const { objectCollection, warnings } = await parser.run(reader)

// Report results
if (PRINT_OBJECTS) {
	printObjectTree(objectCollection.root, PRINT_OBJECTS_OPTIONS)
}
if (warnings.length) {
	console.error('Parser warnings:')
	console.log(...warnings)
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
