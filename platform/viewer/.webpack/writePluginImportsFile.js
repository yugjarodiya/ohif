const pluginConfig = require('../pluginConfig.json');
const fs = require('fs');

const autogenerationDisclaimer = `
// THIS FILE IS AUTOGENERATED AS PART OF THE EXTENSION AND MODE PLUGIN PROCESS.
// IT SHOULD NOT BE MODIFIED MANUALLY \n`;

function constructLines(input, categoryName) {
  let pluginCount = 0;

  const lines = {
    importLines: [],
    addToWindowLines: [],
  };

  input.forEach(entry => {
    const packageName = entry.packageName;

    const defaultImportName = `${categoryName}${pluginCount}`;

    lines.importLines.push(
      `import ${defaultImportName} from '${packageName}';\n`
    );
    lines.addToWindowLines.push(
      `window.${categoryName}.push(${defaultImportName});\n`
    );

    pluginCount++;
  });

  return lines;
}

function getFormattedImportBlock(importLines) {
  let content = '';
  // Imports
  importLines.forEach(importLine => {
    content += importLine;
  });

  return content;
}

function getFormattedWindowBlock(addToWindowLines) {
  let content = `window.extensions = [];\nwindow.modes = [];\n\n`;

  addToWindowLines.forEach(addToWindowLine => {
    content += addToWindowLine;
  });

  return content;
}

function getRuntimeLoadModesExtensions() {
  return "\n\n// Add a dynamic runtime loader\n" +
    "window.runtimeLoadModesExtensions = async () => {\n" +
    "for(const mode of window.modes) {\n" +
    "if( mode.runtimeLoadModesExtensions ) await mode.runtimeLoadModesExtensions(window.modes,window.extensions);\n" +
    "}\n}\n";
}

function writePluginImportsFile(SRC_DIR) {
  let pluginImportsJsContent = autogenerationDisclaimer;

  const extensionLines = constructLines(pluginConfig.extensions, 'extensions');
  const modeLines = constructLines(pluginConfig.modes, 'modes');

  pluginImportsJsContent += getFormattedImportBlock([
    ...extensionLines.importLines,
    ...modeLines.importLines,
  ]);
  pluginImportsJsContent += getFormattedWindowBlock([
    ...extensionLines.addToWindowLines,
    ...modeLines.addToWindowLines,
  ]);

  pluginImportsJsContent += getRuntimeLoadModesExtensions();

  fs.writeFileSync(
    `${SRC_DIR}/pluginImports.js`,
    pluginImportsJsContent,
    { flag: 'w+' },
    err => {
      if (err) {
        console.error(err);
        return;
      }
    }
  );
}

module.exports = writePluginImportsFile;
