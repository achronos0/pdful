/**
 * Utilities to work with pdf objects
 *
 * @module
 */

export class PdfObject {
	readonly type: string = 'unknown'
	protected _value: unknown = null
	constructor (value: unknown) {
		this._value = value
	}
	get value () {
		return this._value
	}
	set value (val) {
		this._value = val
	}
}
export class PdfNumericObject extends PdfObject {
	protected _value: number = 0
}

export class PdfNullObject extends PdfObject {
	readonly type = 'null'
	protected _value: null = null
	get value (): null {
		return null
	}
	set value (val) {
		throw new Error('Cannot set value of null object')
	}
}
export const pdfNull = new PdfNullObject(null)

export class PdfBooleanObject extends PdfObject {
	readonly type = 'boolean'
	protected _value: boolean = false
}

export class PdfInteger extends PdfNumericObject {
	readonly type = 'integer'
	set value (val: number) {
		this._value = Math.floor(val)
	}
}
export class PdfReal extends PdfNumericObject {
	readonly type = 'real'
}

export class PdfString extends PdfObject {
	readonly type = 'string'
	tokenType: 'string' | 'hexstring'
	protected _value: number[] = []
	constructor (value: number[], tokenType: 'string' | 'hexstring') {
		super(value)
		this.tokenType = tokenType
	}
}

export class PdfName extends PdfObject {
	readonly type = 'name'
	protected _value: string = ''
}

export const types = {}
