"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const optimist = require("optimist");
const path = require("path");
/**
 * The command line interface for interacting with the Protractor runner.
 * It takes care of parsing command line options.
 *
 * Values from command line options override values from the config.
 */
let args = [];
process.argv.slice(2).forEach(function (arg) {
    let flag = arg.split('=')[0];
    switch (flag) {
        case 'debug':
            args.push('--nodeDebug');
            args.push('true');
            break;
        case '-d':
        case '--debug':
        case '--debug-brk':
            args.push('--v8Debug');
            args.push('true');
            break;
        default:
            args.push(arg);
            break;
    }
});
// TODO(cnishina): Make cli checks better.
let allowedNames = [
    'seleniumServerJar',
    'seleniumServerStartTimeout',
    'localSeleniumStandaloneOpts',
    'chromeDriver',
    'seleniumAddress',
    'seleniumSessionId',
    'webDriverProxy',
    'useBlockingProxy',
    'sauceUser',
    'sauceKey',
    'sauceAgent',
    'sauceBuild',
    'sauceSeleniumAddress',
    'browserstackUser',
    'browserstackKey',
    'directConnect',
    'firefoxPath',
    'noGlobals',
    'specs',
    'exclude',
    'suites',
    'suite',
    'capabilities',
    'multiCapabilities',
    'getMultiCapabilities',
    'maxSessions',
    'verboseMultiSessions',
    'baseUrl',
    'rootElement',
    'allScriptsTimeout',
    'getPageTimeout',
    'beforeLaunch',
    'onPrepare',
    'onComplete',
    'onCleanUp',
    'afterLaunch',
    'params',
    'resultJsonOutputFile',
    'restartBrowserBetweenTests',
    'untrackOutstandingTimeouts',
    'ignoreUncaughtExceptions',
    'framework',
    'jasmineNodeOpts',
    'mochaOpts',
    'plugins',
    'skipSourceMapSupport',
    'disableEnvironmentOverrides',
    'ng12Hybrid',
    'seleniumArgs',
    'jvmArgs',
    'configDir',
    'troubleshoot',
    'seleniumPort',
    'mockSelenium',
    'v8Debug',
    'nodeDebug',
    'debuggerServerPort',
    'frameworkPath',
    'elementExplorer',
    'debug',
    'disableChecks',
    'browser',
    'name',
    'platform',
    'platform-version',
    'tags',
    'build',
    'grep',
    'invert-grep',
    'explorer'
];
let optimistOptions = {
    describes: {
        help: 'Print Protractor help menu',
        version: 'Print Protractor version',
        browser: 'Browsername, e.g. chrome or firefox',
        seleniumAddress: 'A running selenium address to use',
        seleniumSessionId: 'Attaching an existing session id',
        seleniumServerJar: 'Location of the standalone selenium jar file',
        seleniumPort: 'Optional port for the selenium standalone server',
        baseUrl: 'URL to prepend to all relative paths',
        rootElement: 'Element housing ng-app, if not html or body',
        specs: 'Comma-separated list of files to test',
        exclude: 'Comma-separated list of files to exclude',
        verbose: 'Print full spec names',
        stackTrace: 'Print stack trace on error',
        params: 'Param object to be passed to the tests',
        framework: 'Test framework to use: jasmine, mocha, or custom',
        resultJsonOutputFile: 'Path to save JSON test result',
        troubleshoot: 'Turn on troubleshooting output',
        elementExplorer: 'Interactively test Protractor commands',
        debuggerServerPort: 'Start a debugger server at specified port instead of repl',
        disableChecks: 'disable cli checks'
    },
    aliases: {
        browser: 'capabilities.browserName',
        name: 'capabilities.name',
        platform: 'capabilities.platform',
        'platform-version': 'capabilities.version',
        tags: 'capabilities.tags',
        build: 'capabilities.build',
        grep: 'jasmineNodeOpts.grep',
        'invert-grep': 'jasmineNodeOpts.invertGrep',
        explorer: 'elementExplorer'
    },
    strings: { 'capabilities.tunnel-identifier': '' }
};
optimist.usage('Usage: protractor [configFile] [options]\n' +
    'configFile defaults to protractor.conf.js\n' +
    'The [options] object will override values from the config file.\n' +
    'See the reference config for a full list of options.');
for (let key of Object.keys(optimistOptions.describes)) {
    optimist.describe(key, optimistOptions.describes[key]);
}
for (let key of Object.keys(optimistOptions.aliases)) {
    optimist.alias(key, optimistOptions.aliases[key]);
}
for (let key of Object.keys(optimistOptions.strings)) {
    optimist.string(key);
}
optimist.check(function (arg) {
    if (arg._.length > 1) {
        throw new Error('Error: more than one config file specified');
    }
});
let argv = optimist.parse(args);
if (argv.help) {
    optimist.showHelp();
    process.exit(0);
}
if (argv.version) {
    console.log('Version ' + require(path.resolve(__dirname, '../package.json')).version);
    process.exit(0);
}
if (!argv.disableChecks) {
    // Check to see if additional flags were used.
    let unknownKeys = Object.keys(argv).filter((element) => {
        return element !== '$0' && element !== '_' && allowedNames.indexOf(element) === -1;
    });
    if (unknownKeys.length > 0) {
        throw new Error('Found extra flags: ' + unknownKeys.join(', '));
    }
}
/**
 * Helper to resolve comma separated lists of file pattern strings relative to
 * the cwd.
 *
 * @private
 * @param {Array} list
 */
function processFilePatterns_(list) {
    return list.split(',').map(function (spec) {
        return path.resolve(process.cwd(), spec);
    });
}
;
if (argv.specs) {
    argv.specs = processFilePatterns_(argv.specs);
}
if (argv.exclude) {
    argv.exclude = processFilePatterns_(argv.exclude);
}
// Use default configuration, if it exists.
let configFile = argv._[0];
if (!configFile) {
    if (fs.existsSync('./protractor.conf.js')) {
        configFile = './protractor.conf.js';
    }
}
if (!configFile && !argv.elementExplorer && args.length < 3) {
    console.log('**you must either specify a configuration file ' +
        'or at least 3 options. See below for the options:\n');
    optimist.showHelp();
    process.exit(1);
}
// Run the launcher
const launcher = require("./launcher");
launcher.init(configFile, argv);
//# sourceMappingURL=cli.js.map