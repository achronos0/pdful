/**
 * Convert document data from pdf objects to structured data
 *
 * Structuralizer is the second stage of document loading.
 *
 * @module
 */

import type { PdfError } from '../core.js'
import type { model } from './model.js'
import type { engine } from './engine.js'

export namespace structuralizer {
	export class Structuralizer {
		readonly engine: engine.Engine
		constructor (config: { engine: engine.Engine }) {
			this.engine = config.engine
		}

		run (config: {
			store: model.ObjStore
		}) {
			const store = config.store
			const catalog = store.catalog
			const pdfVersion = store.pdfVersion

			const structure = new this.engine.model.Structure()
			const warnings: PdfError[] = []

			structure.pdfVersion = pdfVersion
			if (!catalog) {
				// @TODO warn
				return { structure, warnings }
			}
			structure.catalog = catalog

			const pagesObj = catalog.children.get('Pages')?.dereference()
			if (pagesObj instanceof this.engine.model.ObjType.Dictionary) {
				const pages: any[] = []
				const walkPagesTree = (dictObj: model.ObjType.Dictionary, parentDictData: object) => {
					const dictData = dictObj.getChildrenData({ except: ['Parent', 'Kids', 'Count']})
					const type = dictData.Type || null
					delete dictData.type
					const combinedDictData = Object.assign({}, parentDictData, dictData)
					if (type === 'Page' || 'Content' in dictData) {
						pages.push(combinedDictData)
						return
					}
					const kidsObj = dictObj.children.get('Kids')
					if (kidsObj instanceof this.engine.model.ObjType.Array) {
						for (const childRefObj of kidsObj.children.values()) {
							const childObj = childRefObj.dereference()
							if (childObj instanceof this.engine.model.ObjType.Dictionary) {
								walkPagesTree(childObj, combinedDictData)
							}
						}
					}
				}
				walkPagesTree(pagesObj, {})
				structure.pages = pages
			}
			if (!structure.pages.length) {
				// @TODO warn
			}

			const catalogEntryHandlers: { [key: string]: (directObj: model.Obj) => void } = {
				Version: directObj => {
					if ('value' in directObj) {
						const value = directObj.value
						if (typeof value === 'string') {
							structure.pdfVersion = value
						}
					}
				}
			}
			for (const [key, obj] of catalog.children.entries()) {
				if (key in catalogEntryHandlers) {
					const directObj = obj.dereference()
					if (directObj) {
						catalogEntryHandlers[key](directObj)
					}
				}
			}

			return { structure, warnings }

			/*
				Catalog
					Pages (REQ)
					Version (1.4)
					Extensions (ISO 32000-1)
					PageLabels (1.3)
					Names (1.2)
					Dests (1.1)
					ViewerPreferences (1.2)
					PageLayout
					PageMode
					Outlines
					Threads (1.1)
					OpenAction (1.1)
					AA (1.2)
					URI (1.1)
					AcroForm (1.2)
					Metadata (1.4)
					StructTreeRoot (1.3)
					MarkInfo (1.4)
					Lang (1.4)
					SpiderInfo (1.3)
					OutputIntents (1.4)
					PieceInfo (1.4)
					OCProperties (1.5)
					Perms (1.5)
					Legal (1.5)
					Requirements (1.7)
					Collection (1.7)
					NeedsRendering (XFA)
					DSS (2.0)
					AF (2.0)
					DPartRoot (2.0)
				Page
					LastModified (1.3)
					Resources (REQ) (INH)
					MediaBox (REQ) (INH)
					CropBox (INH)
					BleedBox (1.3)
					TrimBox (1.3)
					ArtBox (1.3)
					BoxColorInfo (1.4)
					Contents
					Rotate (INH)
					Group (1.4)
					Thumb
					B (1.1)
					Dur (1.1)
					Trans (1.1)
					Annots
					AA (1.2)
					Metadata (1.4)
					PieceInfo (1.3)
					StructParents (1.3)
					ID (1.3)
					PZ (1.3)
					SeparationInfo (1.3)
					Tabs (1.5)
					TemplateInstantiated (1.5)
					PresSteps (1.5)
					UserUnit (1.6)
					VP (1.6)
					AF (2.0)
					OutputIntents (2.0)
					DPart (2.0)
			*/
		}
	}
}
