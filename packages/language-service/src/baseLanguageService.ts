import { createLanguageContext, LanguageServiceHost } from '@volar/language-core';
import * as shared from '@volar/shared';
import * as tsFaster from '@volar/typescript-faster';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createDocumentsAndSourceMaps } from './documents';
import * as autoInsert from './languageFeatures/autoInsert';
import * as callHierarchy from './languageFeatures/callHierarchy';
import * as codeActionResolve from './languageFeatures/codeActionResolve';
import * as codeActions from './languageFeatures/codeActions';
import * as codeLens from './languageFeatures/codeLens';
import * as codeLensResolve from './languageFeatures/codeLensResolve';
import * as completions from './languageFeatures/complete';
import * as completionResolve from './languageFeatures/completeResolve';
import * as definition from './languageFeatures/definition';
import * as documentHighlight from './languageFeatures/documentHighlights';
import * as documentLink from './languageFeatures/documentLinks';
import * as semanticTokens from './languageFeatures/documentSemanticTokens';
import * as executeCommand from './languageFeatures/executeCommand';
import * as fileReferences from './languageFeatures/fileReferences';
import * as fileRename from './languageFeatures/fileRename';
import * as hover from './languageFeatures/hover';
import * as inlayHints from './languageFeatures/inlayHints';
import * as references from './languageFeatures/references';
import * as rename from './languageFeatures/rename';
import * as renamePrepare from './languageFeatures/renamePrepare';
import * as signatureHelp from './languageFeatures/signatureHelp';
import * as diagnostics from './languageFeatures/validation';
import * as workspaceSymbol from './languageFeatures/workspaceSymbols';
import { LanguageServiceConfig, LanguageServicePluginInstance, LanguageServiceRuntimeContext } from './types';
import type * as ts from 'typescript/lib/tsserverlibrary';

import * as colorPresentations from './documentFeatures/colorPresentations';
import * as documentColors from './documentFeatures/documentColors';
import * as documentSymbols from './documentFeatures/documentSymbols';
import * as foldingRanges from './documentFeatures/foldingRanges';
import * as format from './documentFeatures/format';
import * as linkedEditingRanges from './documentFeatures/linkedEditingRanges';
import * as selectionRanges from './documentFeatures/selectionRanges';

// fix build
import type * as _ from 'vscode-languageserver-protocol';

export type LanguageService = ReturnType<typeof createLanguageService>;

export function createLanguageService(
	host: LanguageServiceHost,
	config: LanguageServiceConfig,
	env: LanguageServiceRuntimeContext['env'],
	documentRegistry?: ts.DocumentRegistry,
) {
	const languageContext = createLanguageContext(host, Object.values(config.languages ?? {}).filter(shared.notEmpty));
	const context = createLanguageServiceContext(host, languageContext, config, env, () => languageService, documentRegistry);
	const languageService = createLanguageServiceBase(context);
	return languageService;
}

function createLanguageServiceContext(
	host: LanguageServiceHost,
	languageContext: ReturnType<typeof createLanguageContext>,
	config: LanguageServiceConfig,
	env: LanguageServiceRuntimeContext['env'],
	getLanguageService: () => LanguageService,
	documentRegistry?: ts.DocumentRegistry,
) {

	const ts = host.getTypeScriptModule?.();
	const tsLs = ts?.createLanguageService(languageContext.typescript.languageServiceHost, documentRegistry);

	if (ts && tsLs) {
		tsFaster.decorate(ts, languageContext.typescript.languageServiceHost, tsLs);
	}

	let plugins: { [id: string]: LanguageServicePluginInstance; };

	const textDocumentMapper = createDocumentsAndSourceMaps(languageContext.virtualFiles);
	const documents = new WeakMap<ts.IScriptSnapshot, TextDocument>();
	const documentVersions = new Map<string, number>();
	const context: LanguageServiceRuntimeContext = {
		uriToFileName: shared.uriToFileName,
		fileNameToUri: shared.fileNameToUri,
		host,
		core: languageContext,
		env: env,
		get plugins() {
			if (!plugins) {
				plugins = {}; // avoid infinite loop
				for (const pluginId in config.plugins ?? {}) {
					const plugin = config.plugins?.[pluginId];
					if (plugin instanceof Function) {
						const _plugin = plugin(this, getLanguageService());
						plugins[pluginId] = _plugin;
					}
					else if (plugin) {
						plugins[pluginId] = plugin;
					}
				}
			}
			return plugins;
		},
		rules: config.rules ?? {},
		typescript: ts && tsLs ? {
			module: ts,
			languageServiceHost: languageContext.typescript.languageServiceHost,
			languageService: tsLs,
		} : undefined,
		documents: textDocumentMapper,
		getTextDocument,
	};

	return context;

	function getTextDocument(uri: string) {

		const fileName = shared.uriToFileName(uri);
		const scriptSnapshot = host.getScriptSnapshot(fileName);

		if (scriptSnapshot) {

			let document = documents.get(scriptSnapshot);

			if (!document) {

				const newVersion = (documentVersions.get(uri.toLowerCase()) ?? 0) + 1;

				documentVersions.set(uri.toLowerCase(), newVersion);

				document = TextDocument.create(
					uri,
					shared.syntaxToLanguageId(uri.substring(uri.lastIndexOf('.') + 1)),
					newVersion,
					scriptSnapshot.getText(0, scriptSnapshot.getLength()),
				);
				documents.set(scriptSnapshot, document);
			}

			return document;
		}
	}
}

function createLanguageServiceBase(context: LanguageServiceRuntimeContext) {

	return {

		format: format.register(context),
		getFoldingRanges: foldingRanges.register(context),
		getSelectionRanges: selectionRanges.register(context),
		findLinkedEditingRanges: linkedEditingRanges.register(context),
		findDocumentSymbols: documentSymbols.register(context),
		findDocumentColors: documentColors.register(context),
		getColorPresentations: colorPresentations.register(context),

		doValidation: diagnostics.register(context),
		findReferences: references.register(context),
		findFileReferences: fileReferences.register(context),
		findDefinition: definition.register(context, 'findDefinition', data => !!data.definition, data => !!data.definition),
		findTypeDefinition: definition.register(context, 'findTypeDefinition', data => !!data.definition, data => !!data.definition),
		findImplementations: definition.register(context, 'findImplementations', data => !!data.references, () => false),
		prepareRename: renamePrepare.register(context),
		doRename: rename.register(context),
		getEditsForFileRename: fileRename.register(context),
		getSemanticTokens: semanticTokens.register(context),
		doHover: hover.register(context),
		doComplete: completions.register(context),
		doCodeActions: codeActions.register(context),
		doCodeActionResolve: codeActionResolve.register(context),
		doCompletionResolve: completionResolve.register(context),
		getSignatureHelp: signatureHelp.register(context),
		doCodeLens: codeLens.register(context),
		doCodeLensResolve: codeLensResolve.register(context),
		findDocumentHighlights: documentHighlight.register(context),
		findDocumentLinks: documentLink.register(context),
		findWorkspaceSymbols: workspaceSymbol.register(context),
		doAutoInsert: autoInsert.register(context),
		doExecuteCommand: executeCommand.register(context),
		getInlayHints: inlayHints.register(context),
		callHierarchy: callHierarchy.register(context),
		dispose: () => context.typescript?.languageService.dispose(),
		context,
	};
}
