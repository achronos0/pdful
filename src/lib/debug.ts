/**
 * Debugging utilities
 */

import util from 'node:util'
import { model } from './components/model.js'

export interface PrintObjTreeOptions {
	maxDepth?: number | null,
	indirectValues?: boolean,
	refValues?: boolean,
	contentValues?: boolean
}

export async function printObjTree (obj: model.Obj, options: PrintObjTreeOptions = {}) {
	const {
		maxDepth = null,
		indirectValues = true,
		refValues = true,
		contentValues = true
	} = options
	const print = (str: string) => process.stdout.write(str)
	const refsPrinted: Set<number> = new Set()
	const walker = (obj: model.Obj, depth: number) => {
		let spacer = '  '.repeat(depth + 1)
		let tagSuffix: string | null = null
		const children: [prefix: string, child?: model.Obj][] = []
		if (obj instanceof model.ObjType.Indirect && obj.identifier) {
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
		else if (obj instanceof model.ObjType.Ref && obj.identifier) {
			tagSuffix = ` ->#R${obj.identifier.num}/${obj.identifier.gen}`
			if (obj.indirect) {
				if (obj.direct && refValues) {
					if (refsPrinted.has(obj.uid)) {
						children.push(['Ref: ... (already printed)'])
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
		else if (obj instanceof model.ObjType.Array || obj instanceof model.ObjType.Root || obj instanceof model.ObjType.Table) {
			tagSuffix = `(${obj.length})`
			if (obj instanceof model.ObjType.Table) {
				if (obj.trailer) {
					children.push(['Trailer: ', obj.trailer])
				}
				if (obj.xrefTable) {
					children.push(['Xref table: ' + util.inspect(obj.xrefTable).replace(/\n/gs, '\n' + spacer)])
				}
				if (obj.xrefObj) {
					children.push(['Xref obj: ', obj.xrefObj])
				}
			}
			for (const [index, child] of obj.children.entries()) {
				children.push([`${index}: `, child])
			}
		}
		else if (obj instanceof model.ObjType.Dictionary) {
			tagSuffix = `(${obj.children.size})`
			let index = 0
			for (const [entryKey, entryObj] of obj.children) {
				children.push([`${index}: ${entryKey}: `, entryObj])
				index++
			}
		}
		else if (obj instanceof model.ObjType.Stream) {
			if (obj.dictionary) {
				children.push(['Dictionary: ', obj.dictionary])
			}
			if  (obj.direct && contentValues) {
				children.push(['Data: ', obj.direct])
			}
		}
		else if (obj instanceof model.ObjType.Boolean) {
			tagSuffix = ' ' + obj.value ? ' true' : ' false'
		}
		else if (obj instanceof model.ObjType.Bytes) {
			if (obj.value.length > 300) {
				tagSuffix = ' [' + obj.value.slice(0, 200).join(' ') + ' ...]'
			}
			else {
				tagSuffix = ' [' + obj.value.join(' ') + ']'
			}
		}
		else if (obj instanceof model.ObjType.Text) {
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
		if (!children.length) {
			print('\n')
			return
		}
		if (maxDepth != null && depth > maxDepth) {
			print(' ...\n')
			return
		}
		print('\n')
		for (const [prefix, child] of children) {
			print(spacer + prefix)
			if (child) {
				walker(child, depth + 1)
			}
			else {
				print('\n')
			}
		}
	}
	walker(obj, 0)
}
