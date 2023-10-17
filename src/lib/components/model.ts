/**
 * Utilities to work with pdf object model
 *
 * This is the pdf equivalent of the DOM (Document Object Model), and its structure is (sort of) like the DOM.
 * Although there are differences, and the functionality is much simpler/less complete.
 *
 * @module
 */

export namespace model {
	export interface Obj {
		type: ObjTypeString
		collection: ObjCollection
		parent: ObjWithChildren | null
		uid: number
		getData (): unknown
	}
	export interface ObjWithValue extends Obj {
		value: unknown
	}
	export interface ObjWithChildren extends Obj {
		children: Map<string | number, Obj>
		getChildrenData (): unknown
		getChildrenValue (indirects: number[]): unknown
	}
	export interface ObjConstructor {
		new (collection: ObjCollection, uid: number): Obj
	}

	export type ObjTypeString = (
		'Array' |
		'Boolean' |
		'Bytes' |
		'Comment' |
		'Content' |
		'Date' |
		'Dictionary' |
		'Indirect' |
		'Integer' |
		'Junk' |
		'Name' |
		'Null' |
		'Op' |
		'Real' |
		'Ref' |
		'Root' |
		'Stream' |
		'Table' |
		'Text' |
		'Xref'
	)
	export type ObjWithChildrenTypeString = (
		'Array' |
		'Content' |
		'Dictionary' |
		'Indirect' |
		'Root' |
		'Stream' |
		'Table'
	)

	export interface IndirectObjIdentifier {
		num: number,
		gen: number
	}

	export class ObjCollection {
		static maxUid = 0
		readonly root: RootObj
		objects: Map<number, Obj> = new Map()
		indirects: Map<string, IndirectObj> = new Map()
		refs: Set<RefObj> = new Set()
		streams: Set<StreamObj> = new Set()
		catalog: DictionaryObj | null = null

		constructor () {
			this.root = this.createObject(RootObj)
		}

		uid (uid: number): Obj {
			const obj = this.objects.get(uid)
			if (!obj) {
				throw new Error(`Object not found: uid ${uid}`)
			}
			return obj
		}

		identifier (identifier: IndirectObjIdentifier) {
			const key = String(identifier.num) + '/' + String(identifier.gen)
			const obj = this.indirects.get(key)
			return obj || null
		}

		createObject <T extends ObjConstructor>(Type: T): InstanceType<T> {
			const obj = new Type(this, ++ObjCollection.maxUid)
			this.addObject(obj)
			return obj as InstanceType<T>
		}

		addObject (obj: Obj) {
			obj.collection = this
			this.objects.set(obj.uid, obj)
			if (obj instanceof IndirectObj && obj.identifier) {
				const key = String(obj.identifier.num) + '/' + String(obj.identifier.gen)
				this.indirects.set(key, obj)
			}
			else if (obj instanceof RefObj && !this.refs.has(obj)) {
				this.refs.add(obj)
			}
			else if (obj instanceof StreamObj && !this.streams.has(obj)) {
				this.streams.add(obj)
			}
		}
	}

	abstract class ObjBase {
		collection: ObjCollection
		parent: ObjWithChildren | null = null
		uid: number
		constructor (collection: ObjCollection, uid: number) {
			this.collection = collection
			this.uid = uid
		}
	}

	abstract class ObjStringValueBase extends ObjBase {
		protected _value: string = ''
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	abstract class ObjChildListBase extends ObjBase {
		children: Map<number, Obj> = new Map()
		get length () {
			return this.children.size
		}
		push (obj: Obj) {
			const key = this.children.size
			this.children.set(key, obj)
			// obj.parent = this as unknown as ObjWithChildren
		}
		getChildrenData () {
			const data: unknown[] = []
			for (const [key, obj] of this.children.entries()) {
				data[key] = obj.getData()
			}
			return data
		}
		getChildrenValue (indirects: number[] = []) {
			const data: unknown[] = []
			for (const [key, obj] of this.children.entries()) {
				let val = null
				if ('value' in obj) {
					val = obj.value
				}
				else if ('getChildrenValue' in obj && typeof obj.getChildrenValue === 'function') {
					val = obj.getChildrenValue(indirects)
				}
				data[key] = val
			}
			return data
		}
	}

	class ArrayObj extends ObjChildListBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Array'
		getData () {
			return this.getChildrenData()
		}
	}

	class BooleanObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Boolean'
		protected _value: boolean = false
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	class BytesObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Bytes'
		protected _value: Uint8Array = new Uint8Array(0)
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	class CommentObj extends ObjStringValueBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Comment'
	}

	class ContentObj extends ObjChildListBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Content'
		getData () {
			return this.getChildrenData()
		}
	}

	class DateObj extends ObjBase implements ObjWithValue  {
		readonly type: ObjTypeString = 'Date'
		protected _value: Date = new Date()
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	class DictionaryObj extends ObjBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Dictionary'
		children: Map<string, Obj> = new Map()
		getChildrenData () {
			const data: { [key: string]: unknown } = {}
			for (const [key, obj] of this.children.entries()) {
				data[key] = obj.getData()
			}
			return data
		}
		getData () {
			return this.getChildrenData()
		}
		getChildrenValue (indirects: number[] = []) {
			const data: { [key: string]: unknown } = {}
			for (const [key, obj] of this.children.entries()) {
				let val = null
				if ('value' in obj) {
					val = obj.value
				}
				else if ('getChildrenValue' in obj && typeof obj.getChildrenValue === 'function') {
					val = obj.getChildrenValue(indirects)
				}
				data[key] = val
			}
			return data
		}
	}

	class IndirectObj extends ObjBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Indirect'
		children: Map<'direct', Obj> = new Map()
		identifier:  IndirectObjIdentifier | null = null
		get direct () {
			return this.children.get('direct') || null
		}
		set direct (obj) {
			if (obj) {
				this.children.set('direct', obj)
			}
			else {
				this.children.delete('direct')
			}
		}
		getChildrenData () {
			return {
				direct: this.direct ? this.direct.getData() : null
			}
		}
		getChildrenValue (indirects?: number[]): unknown {
			let val = null
			const obj = this.direct
			if (obj) {
				if ('value' in obj) {
					val = obj.value
				}
				else if ('getChildrenValue' in obj && typeof obj.getChildrenValue === 'function') {
					val = obj.getChildrenValue(indirects)
				}
			}
			return {
				direct: val
			}
		}
		getData () {
			const identifier = this.identifier
			const direct = this.direct ? this.direct.getData() : null
			return { identifier, direct }
		}
	}

	class IntegerObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Integer'
		protected _value: number = 0
		get value () {
			return this._value
		}
		set value (val: number) {
			this._value = Math.floor(val)
		}
		getData () {
			return this.value
		}
	}

	class JunkObj extends ObjStringValueBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Junk'
	}

	class NameObj extends ObjStringValueBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Name'
	}

	class NullObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Null'
		get value () {
			return null
		}
		set value (val) {}
		getData () {
			return null
		}
	}

	class OpObj extends ObjStringValueBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Op'
	}

	class RealObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Real'
		protected _value: number = 0
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	class RefObj extends ObjBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Ref'
		identifier: null | { num: number, gen: number } = null
		children: Map<'indirect', IndirectObj> = new Map()
		get indirect () {
			return this.children.get('indirect') || null
		}
		set indirect (obj) {
			if (obj) {
				this.children.set('indirect', obj)
			}
			else {
				this.children.delete('indirect')
			}
		}
		get direct () {
			const indirect = this.indirect
			return indirect ? indirect.direct : null
		}
		getData() {
			const identifier = this.identifier
			const indirectUid = this.indirect ? this.indirect.uid : null
			return { identifier, indirectUid }
		}
		getChildrenData () {
			return {
				indirect: this.indirect ? this.indirect.getData() : null
			}
		}
		getChildrenValue (indirects: number[] = []) {
			const indirect = this.indirect
			if (indirect && !indirects.includes(indirect.uid)) {
				indirects.push(indirect.uid)
				if (indirect.direct) {
					const obj = indirect.direct
					let val
					if ('value' in obj) {
						val = obj.value
					}
					else if ('getChildrenValue' in obj && typeof obj.getChildrenValue === 'function') {
						val = obj.getChildrenValue(indirects)
					}
					else {
						val = null
					}
					return val
				}
			}
			return null
		}
	}

	class RootObj extends ObjChildListBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Root'
		getData () {
			return this.getChildrenData()
		}
	}

	class StreamObj extends ObjBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Stream'
		children: Map<'dictionary' | 'direct', DictionaryObj | ContentObj | ArrayObj | TextObj | BytesObj | XrefObj> = new Map()
		sourceLocation: { start: number, end: number } | null = null
		streamType: string | null = null
		get dictionary (): DictionaryObj | null {
			return this.children.get('dictionary') as DictionaryObj || null
		}
		set dictionary (obj) {
			if (obj) {
				this.children.set('dictionary', obj)
			}
			else {
				this.children.delete('dictionary')
			}
		}
		get direct (): ContentObj | ArrayObj | TextObj | BytesObj | XrefObj | null {
			return this.children.get('direct') as ContentObj | ArrayObj | TextObj | BytesObj || null
		}
		set direct (obj) {
			if (obj) {
				this.children.set('direct', obj)
			}
			else {
				this.children.delete('direct')
			}
		}
		getChildrenData () {
			return {
				direct: this.direct ? this.direct.getData() : null
			}
		}
		getChildrenValue (indirects: number[] = []): unknown {
			let val = null
			const obj = this.direct
			if (obj) {
				if ('value' in obj) {
					val = obj.value
				}
				else if ('getChildrenValue' in obj && typeof obj.getChildrenValue === 'function') {
					val = obj.getChildrenValue(indirects)
				}
			}
			return {
				direct: val
			}
		}
		getData () {
			const dictionary = this.dictionary ? this.dictionary.getData() : null
			const direct = this.direct ? this.direct.getData() : null
			return { dictionary, direct }
		}
	}

	class TableObj extends ObjChildListBase implements ObjWithChildren {
		readonly type: ObjTypeString = 'Table'
		xrefTable: {
			startNum: number,
			objs: Array<
				{ num: number, offset: number, gen: number, type: 'n' } |
				{ num: number, nextFree: number, reuseGen: number, type: 'f' }
			>
		} | null = null
		xrefObj: XrefObj | null = null
		trailer: DictionaryObj | null = null
		startxref: number | null = null
		getData () {
			return {
				children: this.getChildrenData(),
				xrefTable: this.xrefTable,
				xrefObj: this.xrefObj ? this.xrefObj.getData() : null,
				trailer: this.trailer ? this.trailer.getChildrenValue() : null,
				startxref: this.startxref
			}
		}
	}

	class TextObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Text'
		encoding: 'pdf' | 'utf-16be' | 'utf-8' = 'pdf'
		tokenType: 'string' | 'hexstring' = 'string'
		protected _value: string = ''
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return {
				value: this.value,
				encoding: this.encoding,
				tokenType: this.tokenType
			}
		}
	}

	class XrefObj extends ObjBase implements ObjWithValue {
		readonly type: ObjTypeString = 'Xref'
		protected _value: {
			widths: number[],
			subsections: Array<{ startNum: number, count: number }>,
			objTable: Array<
				{ num: number, type: 0, nextFree: number, reuseGen: number } |
				{ num: number, type: 1, offset: number, gen: number } |
				{ num: number, type: 2, streamNum: number, indexInStream: number } |
				{ num: number, fields: Array<number | null> }
			>
		} | null = null
		get value () {
			return this._value
		}
		set value (val) {
			this._value = val
		}
		getData () {
			return this.value
		}
	}

	export const ObjType = {
		Array: ArrayObj,
		Boolean: BooleanObj,
		Bytes: BytesObj,
		Comment: CommentObj,
		Content: ContentObj,
		Date: DateObj,
		Dictionary: DictionaryObj,
		Indirect: IndirectObj,
		Integer: IntegerObj,
		Junk: JunkObj,
		Name: NameObj,
		Null: NullObj,
		Op: OpObj,
		Real: RealObj,
		Ref: RefObj,
		Root: RootObj,
		Stream: StreamObj,
		Table: TableObj,
		Text: TextObj,
		Xref: XrefObj
	}

	export namespace ObjType {
		export type Array = ArrayObj
		export type Boolean = BooleanObj
		export type Bytes = BytesObj
		export type Comment = CommentObj
		export type Content = ContentObj
		export type Date = DateObj
		export type Dictionary = DictionaryObj
		export type Indirect = IndirectObj
		export type Integer = IntegerObj
		export type Junk = JunkObj
		export type Name = NameObj
		export type Null = NullObj
		export type Op = OpObj
		export type Real = RealObj
		export type Ref = RefObj
		export type Root = RootObj
		export type Stream = StreamObj
		export type Text = TextObj
		export type Xref = XrefObj
	}
}
