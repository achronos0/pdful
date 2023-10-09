
import fs from 'node:fs/promises'
import { SequentialFileReader, SequentialMemoryReader } from '../lib/reader.js'
import { createTokenizer, Token } from '../lib/tokenizer.js'

const TEST_FILE = 'input/1.pdf'
const TEST_BUFFER = true
let reader
if (TEST_BUFFER) {
	const buffer = await fs.readFile(TEST_FILE)
	const bytes = Uint8Array.from(buffer)
	reader = SequentialMemoryReader.createFromArray(bytes)
}
else {
	const fileHandle = await fs.open(TEST_FILE, 'real')
	reader = await SequentialFileReader.createFromFileHandle(fileHandle)
}
const tokenizer = createTokenizer(reader)

await tokenizer.start()
const allTokens: Token[] = []
const tokenGenerator = tokenizer.tokens()
for await (const token of tokenGenerator) {
	allTokens.push(token)
	switch (token.type) {
		// sp -- whitespace
		case 'space':
			// ignore
			break
		// c -- comment
		case 'comment':
			// ignore
			break
		// junk -- invalid/unrecognized token
		case 'junk':
			// ignore
			break
		// null -- null object
		case 'null':
			break
		// b -- boolean
		case 'boolean':
			break
		// i -- integer number
		case 'integer':
			break
		// r -- real number (floating point)
		case 'real':
			break
		// s -- string
		case 'string':
			break
		// h -- hex string
		case 'hexstring':
			break
		// n -- name
		case 'name':
			break
		// as -- array start
		case 'arraystart':
			break
		// ae -- array end
		case 'arrayend':
			break
		// ds -- dictionary start
		case 'dictstart':
			break
		// de -- dictionary end
		case 'dictend':
			break
		// os -- indirect object definition start
		case 'objstart':
			break
		// oe -- indirect object definition end
		case 'objend':
			break
		// ref -- indirect object reference
		case 'ref':
			break
		// stream -- stream object
		case 'stream':
			break
		// xref -- xref section
		case 'xref':
			break
		// trailer -- trailer section
		case 'trailer':
			break
		// eof -- eof of file section
		case 'eof':
			break
	}
}
const warnings = tokenizer.warnings

console.log('tokens=', allTokens.slice(19300), 'warnings=', warnings)

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
