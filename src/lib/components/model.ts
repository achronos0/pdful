/**
 * Utilities to work with pdf document object model
 *
 * @module
 */

export namespace model {
	export interface PdfObject {
		type: TypeString
		collection: Collection
		uid: number
		getData (): unknown
	}
	export interface PdfObjectWithValue extends PdfObject {
		value: unknown
	}
	export interface PdfObjectWithChildren extends PdfObject {
		children: Map<string | number, PdfObject>
	}
	export interface PdfObjectConstructor {
		new (collection: Collection, uid: number): PdfObject
	}
	export interface IndirectIdentifier {
		num: number,
		gen: number
	}

	export type TypeString = (
		'Null' | 'Boolean' | 'Integer' | 'Real' | 'Text' | 'Bytes' | 'Date' | 'Name' |
		'Array' | 'Dictionary' | 'Indirect' | 'Ref' | 'Stream' | 'Xref' |
		'Content' | 'Op' | 'Root'
	)
	export type WithChildrenTypeString = 'Array' | 'Dictionary' | 'Indirect' | 'Stream' | 'Content' | 'Root'

	export class Collection {
		static maxUid = 0
		readonly root: PdfObjectRoot
		objects: Map<number, PdfObject> = new Map()
		indirects: Map<string, PdfObjectIndirect> = new Map()
		refs: Set<PdfObjectRef> = new Set()
		streams: Set<PdfObjectStream> = new Set()

		constructor () {
			this.root = this.createObject(PdfObjectRoot)
		}

		uid (uid: number): PdfObject {
			const obj = this.objects.get(uid)
			if (!obj) {
				throw new Error(`Object not found: uid ${uid}`)
			}
			return obj
		}

		identifier (identifier: IndirectIdentifier) {
			const key = String(identifier.num) + '/' + String(identifier.gen)
			const obj = this.indirects.get(key)
			return obj || null
		}

		createObject <T extends PdfObjectConstructor>(Type: T): InstanceType<T> {
			const obj = new Type(this, ++Collection.maxUid)
			this.addObject(obj)
			return obj as InstanceType<T>
		}

		addObject (obj: PdfObject) {
			obj.collection = this
			this.objects.set(obj.uid, obj)
			if (obj instanceof PdfObjectIndirect && obj.identifier) {
				const key = String(obj.identifier.num) + '/' + String(obj.identifier.gen)
				this.indirects.set(key, obj)
			}
			else if (obj instanceof PdfObjectRef && !this.refs.has(obj)) {
				this.refs.add(obj)
			}
			else if (obj instanceof PdfObjectStream && !this.streams.has(obj)) {
				this.streams.add(obj)
			}
		}
	}

	abstract class PdfObjectBase {
		collection: Collection
		uid: number
		constructor (collection: Collection, uid: number) {
			this.collection = collection
			this.uid = uid
		}
	}

	export class PdfObjectNull extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Null'
		get value () {
			return null
		}
		set value (val) {}
		getData () {
			return null
		}
	}

	export class PdfObjectBoolean extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Boolean'
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

	export class PdfObjectInteger extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Integer'
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
	export class PdfObjectReal extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Real'
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

	export class PdfObjectText extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Text'
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

	export class PdfObjectBytes extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Bytes'
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

	export class PdfObjectDate extends PdfObjectBase implements PdfObjectWithValue  {
		readonly type: TypeString = 'Date'
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

	export class PdfObjectName extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Name'
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

	export class PdfObjectArray extends PdfObjectBase implements PdfObjectWithChildren {
		readonly type: TypeString = 'Array'
		children: Map<number, PdfObject> = new Map()
		get length () {
			return this.children.size
		}
		push (obj: PdfObject) {
			const key = this.children.size
			this.children.set(key, obj)
		}
		getData () {
			const data: Map<number, unknown> = new Map()
			for (const [key, obj] of this.children.entries()) {
				data.set(key, obj.getData())
			}
			return data
		}
		getAsArray () {
			return Array.from(this.getData())
		}
	}

	export class PdfObjectDictionary extends PdfObjectBase implements PdfObjectWithChildren {
		readonly type: TypeString = 'Dictionary'
		children: Map<string, PdfObject> = new Map()
		getData () {
			const data: Map<string, unknown> = new Map()
			for (const [key, obj] of this.children.entries()) {
				data.set(key, obj.getData())
			}
			return data
		}
		getAsObject () {
			return Object.fromEntries(this.getData())
		}
	}

	export class PdfObjectIndirect extends PdfObjectBase implements PdfObjectWithChildren {
		readonly type: TypeString = 'Indirect'
		children: Map<'direct', PdfObject> = new Map()
		identifier:  IndirectIdentifier | null = null
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
		getData() {
			const identifier = this.identifier
			const direct = this.direct
			return { identifier, direct }
		}
	}

	export class PdfObjectRef extends PdfObjectBase implements PdfObjectWithChildren {
		readonly type: TypeString = 'Ref'
		identifier: null | { num: number, gen: number } = null
		children: Map<'indirect', PdfObjectIndirect> = new Map()
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
			const indirect = this.indirect
			const direct = this.direct
			return { identifier, indirect, direct }
		}
	}

	export class PdfObjectStream extends PdfObjectBase implements PdfObjectWithChildren {
		readonly type: TypeString = 'Stream'
		children: Map<'dictionary' | 'direct', PdfObjectDictionary | PdfObjectContent | PdfObjectArray | PdfObjectText | PdfObjectBytes> = new Map()
		sourceLocation: { start: number, end: number } | null = null
		decodedBytes: Uint8Array | null = null
		get dictionary (): PdfObjectDictionary | null {
			return this.children.get('dictionary') as PdfObjectDictionary || null
		}
		set dictionary (obj) {
			if (obj) {
				this.children.set('dictionary', obj)
			}
			else {
				this.children.delete('dictionary')
			}
		}
		get direct (): PdfObjectContent | PdfObjectArray | PdfObjectText | PdfObjectBytes | null {
			return this.children.get('direct') as PdfObjectContent | PdfObjectArray | PdfObjectText | PdfObjectBytes || null
		}
		set direct (obj) {
			if (obj) {
				this.children.set('direct', obj)
			}
			else {
				this.children.delete('direct')
			}
		}
		getData() {
			const dictionary = this.dictionary
			const direct = this.direct
			return { dictionary, direct }
		}
	}

	export class PdfObjectXref extends PdfObjectBase implements PdfObjectWithValue {
		readonly type: TypeString = 'Xref'
		protected _value: any = null
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

	export class PdfObjectContent extends PdfObjectArray {
		readonly type: TypeString = 'Content'
	}

	export class PdfObjectOp extends PdfObjectName {
		readonly type: TypeString = 'Op'
	}

	export class PdfObjectRoot extends PdfObjectArray {
		readonly type: TypeString = 'Root'
	}

	export const PdfObjectType = {
		Array: PdfObjectArray,
		Boolean: PdfObjectBoolean,
		Bytes: PdfObjectBytes,
		Content: PdfObjectContent,
		Date: PdfObjectDate,
		Dictionary: PdfObjectDictionary,
		Indirect: PdfObjectIndirect,
		Integer: PdfObjectInteger,
		Name: PdfObjectName,
		Null: PdfObjectNull,
		Op: PdfObjectOp,
		Real: PdfObjectReal,
		Ref: PdfObjectRef,
		Root: PdfObjectRoot,
		Stream: PdfObjectStream,
		Text: PdfObjectText,
		Xref: PdfObjectXref
	}

	export namespace PdfObjectType {
		export type Array = PdfObjectArray
		export type Boolean = PdfObjectBoolean
		export type Bytes = PdfObjectBytes
		export type Content = PdfObjectContent
		export type Date = PdfObjectDate
		export type Dictionary = PdfObjectDictionary
		export type Indirect = PdfObjectIndirect
		export type Integer = PdfObjectInteger
		export type Name = PdfObjectName
		export type Null = PdfObjectNull
		export type Real = PdfObjectReal
		export type Ref = PdfObjectRef
		export type Root = PdfObjectRoot
		export type Stream = PdfObjectStream
		export type Text = PdfObjectText
	}
}
