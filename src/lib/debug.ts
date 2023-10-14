/**
 * Debugging utilities
 */

import { model } from './components/model.js'

export interface PrintObjectTreeOptions {
	maxDepth?: number | null,
	indirectValues?: boolean,
	refValues?: boolean,
	contentValues?: boolean
}

export async function printObjectTree (obj: model.PdfObject, options: PrintObjectTreeOptions = {}) {
	const {
		maxDepth = null,
		indirectValues = true,
		refValues = true,
		contentValues = true
	} = options
	const print = (str: string) => process.stdout.write(str)
	const refsPrinted: Set<number> = new Set()
	const walker = (obj: model.PdfObject, depth: number) => {
		let tagSuffix: string | null = null
		const children: [prefix: string, child: model.PdfObject][] = []
		let extraLines: string[] = []
		if (obj instanceof model.PdfObjectType.Indirect && obj.identifier) {
			tagSuffix = ` #R${obj.identifier.num}/${obj.identifier.gen}`
			if (obj.direct) {
				if (indirectValues) {
					children.push(['Value: ', obj.direct])
				}
			}
			else {
				tagSuffix += ' EMPTY'
			}
		}
		else if (obj instanceof model.PdfObjectType.Ref && obj.identifier) {
			tagSuffix = ` ->#R${obj.identifier.num}/${obj.identifier.gen}`
			if (obj.indirect) {
				if (obj.direct && refValues) {
					if (refsPrinted.has(obj.uid)) {
						extraLines.push('Ref: ... (already printed)')
					}
					else {
						children.push(['Ref: ', obj.direct])
						refsPrinted.add(obj.uid)
					}
				}
			}
			else {
				tagSuffix += ' MISSING'
			}
		}
		else if (obj instanceof model.PdfObjectType.Array) {
			tagSuffix = `(${obj.length})`
			for (const child of obj.children.values()) {
				children.push(['', child])
			}
		}
		else if (obj instanceof model.PdfObjectType.Dictionary) {
			tagSuffix = `(${obj.children.size})`
			for (const [entryKey, entryObj] of obj.children) {
				children.push([entryKey + ': ', entryObj])
			}
		}
		else if (obj instanceof model.PdfObjectType.Stream) {
			if (obj.dictionary) {
				children.push(['Dictionary: ', obj.dictionary])
			}
			if  (obj.direct && contentValues) {
				children.push(['Data: ', obj.direct])
			}
		}
		else if (obj instanceof model.PdfObjectType.Boolean) {
			tagSuffix = ' ' + obj.value ? ' true' : ' false'
		}
		else if (obj instanceof model.PdfObjectType.Bytes) {
			if (obj.value.length > 300) {
				tagSuffix = ' [' + obj.value.slice(0, 200).join(' ') + ' ...]'
			}
			else {
				tagSuffix = ' [' + obj.value.join(' ') + ']'
			}
		}
		else if (obj instanceof model.PdfObjectType.Text) {
			tagSuffix = `(${obj.tokenType}/${obj.encoding})`
			if (obj.value.length > 300) {
				tagSuffix += ` "${obj.value.substring(0, 200)}..."`
			}
			else {
				tagSuffix += ` "${obj.value}"`
			}
		}
		else if ('value' in obj) {
			tagSuffix = ' ' + String(obj.value)
			if (tagSuffix.length > 300) {
				tagSuffix = tagSuffix.substring(0, 200) + '...'
			}
		}

		print(obj.type)
		if (tagSuffix) {
			print(tagSuffix)
		}
		if (!children.length && !extraLines.length) {
			print('\n')
			return
		}
		if (maxDepth != null && depth > maxDepth) {
			print(' ...\n')
			return
		}
		print('\n')
		let spacer = '  '.repeat(depth + 1)
		for (const [prefix, child] of children) {
			print(spacer + prefix)
			walker(child, depth + 1)
		}
		for (const line of extraLines) {
			print(spacer + line + '\n')
		}
	}
	walker(obj, 0)
}
