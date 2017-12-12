"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const blocking_proxy_1 = require("blocking-proxy");
const selenium_webdriver_1 = require("selenium-webdriver");
const url = require("url");
const webdriver_js_extender_1 = require("webdriver-js-extender");
const debugger_1 = require("./debugger");
const element_1 = require("./element");
const expectedConditions_1 = require("./expectedConditions");
const locators_1 = require("./locators");
const logger_1 = require("./logger");
const plugins_1 = require("./plugins");
const clientSideScripts = require('./clientsidescripts');
// TODO: fix the typings for selenium-webdriver/lib/command
const Command = require('selenium-webdriver/lib/command').Command;
const CommandName = require('selenium-webdriver/lib/command').Name;
// jshint browser: true
const DEFER_LABEL = 'NG_DEFER_BOOTSTRAP!';
const DEFAULT_RESET_URL = 'data:text/html,<html></html>';
const DEFAULT_GET_PAGE_TIMEOUT = 10000;
let logger = new logger_1.Logger('protractor');
// TODO(cnishina): either remove for loop entirely since this does not export anything
// the user might need since everything is composed (with caveat that this could be a
// potential breaking change) or export the types with `export * from 'selenium-webdriver'`;
/*
 * Mix in other webdriver functionality to be accessible via protractor.
 */
for (let foo in require('selenium-webdriver')) {
    exports[foo] = require('selenium-webdriver')[foo];
}
// Explicitly define webdriver.WebDriver
// TODO: extend WebDriver from selenium-webdriver typings
class AbstractWebDriver {
}
exports.AbstractWebDriver = AbstractWebDriver;
class AbstractExtendedWebDriver extends AbstractWebDriver {
}
exports.AbstractExtendedWebDriver = AbstractExtendedWebDriver;
/**
 * Mix a function from one object onto another. The function will still be
 * called in the context of the original object.  Any arguments of type
 * `ElementFinder` will be unwrapped to their underlying `WebElement` instance
 *
 * @private
 * @param {Object} to
 * @param {Object} from
 * @param {string} fnName
 * @param {function=} setupFn
 */
function ptorMixin(to, from, fnName, setupFn) {
    to[fnName] = function () {
        for (let i = 0; i < arguments.length; i++) {
            if (arguments[i] instanceof element_1.ElementFinder) {
                arguments[i] = arguments[i].getWebElement();
            }
        }
        if (setupFn) {
            setupFn();
        }
        return from[fnName].apply(from, arguments);
    };
}
;
/**
 * Build the helper 'element' function for a given instance of Browser.
 *
 * @private
 * @param {Browser} browser A browser instance.
 * @returns {function(webdriver.Locator): ElementFinder}
 */
function buildElementHelper(browser) {
    let element = ((locator) => {
        return new element_1.ElementArrayFinder(browser).all(locator).toElementFinder_();
    });
    element.all = (locator) => {
        return new element_1.ElementArrayFinder(browser).all(locator);
    };
    return element;
}
;
/**
 * @alias browser
 * @constructor
 * @extends {webdriver_extensions.ExtendedWebDriver}
 * @param {webdriver.WebDriver} webdriver
 * @param {string=} opt_baseUrl A base URL to run get requests against.
 * @param {string=} opt_rootElement  Selector element that has an ng-app in
 *     scope.
 * @param {boolean=} opt_untrackOutstandingTimeouts Whether Protractor should
 *     stop tracking outstanding $timeouts.
 */
class ProtractorBrowser extends AbstractExtendedWebDriver {
    constructor(webdriverInstance, opt_baseUrl, opt_rootElement, opt_untrackOutstandingTimeouts, opt_blockingProxyUrl) {
        super();
        // These functions should delegate to the webdriver instance, but should
        // wait for Angular to sync up before performing the action. This does not
        // include functions which are overridden by protractor below.
        let methodsToSync = ['getCurrentUrl', 'getPageSource', 'getTitle'];
        let extendWDInstance;
        try {
            extendWDInstance = webdriver_js_extender_1.extend(webdriverInstance);
        }
        catch (e) {
            // Probably not a driver that can be extended (e.g. gotten using
            // `directConnect: true` in the config)
            extendWDInstance = webdriverInstance;
        }
        // Mix all other driver functionality into Protractor.
        Object.getOwnPropertyNames(selenium_webdriver_1.WebDriver.prototype).forEach(method => {
            if (!this[method] && typeof extendWDInstance[method] === 'function') {
                if (methodsToSync.indexOf(method) !== -1) {
                    ptorMixin(this, extendWDInstance, method, this.waitForAngular.bind(this));
                }
                else {
                    ptorMixin(this, extendWDInstance, method);
                }
            }
        });
        this.driver = extendWDInstance;
        if (opt_blockingProxyUrl) {
            logger.info('Starting BP client for ' + opt_blockingProxyUrl);
            this.bpClient = new blocking_proxy_1.BPClient(opt_blockingProxyUrl);
        }
        this.element = buildElementHelper(this);
        this.$ = element_1.build$(this.element, selenium_webdriver_1.By);
        this.$$ = element_1.build$$(this.element, selenium_webdriver_1.By);
        this.baseUrl = opt_baseUrl || '';
        this.rootEl = opt_rootElement || '';
        this.ignoreSynchronization = false;
        this.getPageTimeout = DEFAULT_GET_PAGE_TIMEOUT;
        this.params = {};
        this.ready = null;
        this.plugins_ = new plugins_1.Plugins({});
        this.resetUrl = DEFAULT_RESET_URL;
        this.debugHelper = new debugger_1.DebugHelper(this);
        let ng12Hybrid_ = false;
        Object.defineProperty(this, 'ng12Hybrid', {
            get: function () {
                return ng12Hybrid_;
            },
            set: function (ng12Hybrid) {
                if (ng12Hybrid) {
                    logger.warn('You have set ng12Hybrid.  As of Protractor 4.1.0, ' +
                        'Protractor can automatically infer if you are using an ' +
                        'ngUpgrade app (as long as ng1 is loaded before you call ' +
                        'platformBrowserDynamic()), and this flag is no longer needed ' +
                        'for most users');
                }
                ng12Hybrid_ = ng12Hybrid;
            }
        });
        this.driver.getCapabilities().then((caps) => {
            // Internet Explorer does not accept data URLs, which are the default
            // reset URL for Protractor.
            // Safari accepts data urls, but SafariDriver fails after one is used.
            // PhantomJS produces a "Detected a page unload event" if we use data urls
            let browserName = caps.get('browserName');
            if (browserName === 'internet explorer' || browserName === 'safari' ||
                browserName === 'phantomjs' || browserName === 'MicrosoftEdge') {
                this.resetUrl = 'about:blank';
            }
        });
        this.trackOutstandingTimeouts_ = !opt_untrackOutstandingTimeouts;
        this.mockModules_ = [];
        this.addBaseMockModules_();
        // set up expected conditions
        this.ExpectedConditions = new expectedConditions_1.ProtractorExpectedConditions(this);
    }
    /**
     * If true, Protractor will not attempt to synchronize with the page before
     * performing actions. This can be harmful because Protractor will not wait
     * until $timeouts and $http calls have been processed, which can cause
     * tests to become flaky. This should be used only when necessary, such as
     * when a page continuously polls an API using $timeout.
     *
     * This property is deprecated - please use waitForAngularEnabled instead.
     *
     * @deprecated
     * @type {boolean}
     */
    set ignoreSynchronization(value) {
        this.driver.controlFlow().execute(() => {
            if (this.bpClient) {
                logger.debug('Setting waitForAngular' + value);
                this.bpClient.setSynchronization(!value);
            }
        }, `Set proxy synchronization to ${value}`);
        this.internalIgnoreSynchronization = value;
    }
    get ignoreSynchronization() {
        return this.internalIgnoreSynchronization;
    }
    /**
     * If set to false, Protractor will not wait for Angular $http and $timeout
     * tasks to complete before interacting with the browser. This can cause
     * flaky tests, but should be used if, for instance, your app continuously
     * polls an API with $timeout.
     *
     * Call waitForAngularEnabled() without passing a value to read the current
     * state without changing it.
     */
    waitForAngularEnabled(enabled = null) {
        if (enabled != null) {
            this.ignoreSynchronization = !enabled;
        }
        return !this.ignoreSynchronization;
    }
    /**
     * Get the processed configuration object that is currently being run. This
     * will contain the specs and capabilities properties of the current runner
     * instance.
     *
     * Set by the runner.
     *
     * @returns {webdriver.promise.Promise} A promise which resolves to the
     * capabilities object.
     */
    getProcessedConfig() {
        return null;
    }
    /**
     * Fork another instance of browser for use in interactive tests.
     *
     * Set by the runner.
     *
     * @param {boolean} opt_useSameUrl Whether to navigate to current url on
     * creation
     * @param {boolean} opt_copyMockModules Whether to apply same mock modules on
     * creation
     * @returns {Browser} A browser instance.
     */
    forkNewDriverInstance(opt_useSameUrl, opt_copyMockModules) {
        return null;
    }
    /**
     * Restart the browser instance.
     *
     * Set by the runner.
     */
    restart() {
        return;
    }
    /**
     * Instead of using a single root element, search through all angular apps
     * available on the page when finding elements or waiting for stability.
     * Only compatible with Angular2.
     */
    useAllAngular2AppRoots() {
        // The empty string is an invalid css selector, so we use it to easily
        // signal to scripts to not find a root element.
        this.rootEl = '';
    }
    /**
     * The same as {@code webdriver.WebDriver.prototype.executeScript},
     * but with a customized description for debugging.
     *
     * @private
     * @param {!(string|Function)} script The script to execute.
     * @param {string} description A description of the command for debugging.
     * @param {...*} var_args The arguments to pass to the script.
     * @returns {!webdriver.promise.Promise.<T>} A promise that will resolve to
     * the scripts return value.
     * @template T
     */
    executeScriptWithDescription(script, description, ...scriptArgs) {
        if (typeof script === 'function') {
            script = 'return (' + script + ').apply(null, arguments);';
        }
        return this.driver.schedule(new Command(CommandName.EXECUTE_SCRIPT)
            .setParameter('script', script)
            .setParameter('args', scriptArgs), description);
    }
    /**
     * The same as {@code webdriver.WebDriver.prototype.executeAsyncScript},
     * but with a customized description for debugging.
     *
     * @private
     * @param {!(string|Function)} script The script to execute.
     * @param {string} description A description for debugging purposes.
     * @param {...*} var_args The arguments to pass to the script.
     * @returns {!webdriver.promise.Promise.<T>} A promise that will resolve to
     * the
     *    scripts return value.
     * @template T
     */
    executeAsyncScript_(script, description, ...scriptArgs) {
        if (typeof script === 'function') {
            script = 'return (' + script + ').apply(null, arguments);';
        }
        return this.driver.schedule(new Command(CommandName.EXECUTE_ASYNC_SCRIPT)
            .setParameter('script', script)
            .setParameter('args', scriptArgs), description);
    }
    /**
     * Instruct webdriver to wait until Angular has finished rendering and has
     * no outstanding $http or $timeout calls before continuing.
     * Note that Protractor automatically applies this command before every
     * WebDriver action.
     *
     * @param {string=} opt_description An optional description to be added
     *     to webdriver logs.
     * @returns {!webdriver.promise.Promise} A promise that will resolve to the
     *    scripts return value.
     */
    waitForAngular(opt_description) {
        let description = opt_description ? ' - ' + opt_description : '';
        if (this.ignoreSynchronization) {
            return this.driver.controlFlow().execute(() => {
                return true;
            }, 'Ignore Synchronization Protractor.waitForAngular()');
        }
        let runWaitForAngularScript = () => {
            if (this.plugins_.skipAngularStability() || this.bpClient) {
                return selenium_webdriver_1.promise.fulfilled();
            }
            else {
                return this.executeAsyncScript_(clientSideScripts.waitForAngular, 'Protractor.waitForAngular()' + description, this.rootEl);
            }
        };
        return runWaitForAngularScript()
            .then((browserErr) => {
            if (browserErr) {
                throw new Error('Error while waiting for Protractor to ' +
                    'sync with the page: ' + JSON.stringify(browserErr));
            }
        })
            .then(() => {
            return this.driver.controlFlow()
                .execute(() => {
                return this.plugins_.waitForPromise();
            }, 'Plugins.waitForPromise()')
                .then(() => {
                return this.driver.wait(() => {
                    return this.plugins_.waitForCondition().then((results) => {
                        return results.reduce((x, y) => x && y, true);
                    });
                }, this.allScriptsTimeout, 'Plugins.waitForCondition()');
            });
        }, (err) => {
            let timeout;
            if (/asynchronous script timeout/.test(err.message)) {
                // Timeout on Chrome
                timeout = /-?[\d\.]*\ seconds/.exec(err.message);
            }
            else if (/Timed out waiting for async script/.test(err.message)) {
                // Timeout on Firefox
                timeout = /-?[\d\.]*ms/.exec(err.message);
            }
            else if (/Timed out waiting for an asynchronous script/.test(err.message)) {
                // Timeout on Safari
                timeout = /-?[\d\.]*\ ms/.exec(err.message);
            }
            if (timeout) {
                let errMsg = `Timed out waiting for asynchronous Angular tasks to finish after ` +
                    `${timeout}. This may be because the current page is not an Angular ` +
                    `application. Please see the FAQ for more details: ` +
                    `https://github.com/angular/protractor/blob/master/docs/timeouts.md#waiting-for-angular`;
                if (description.indexOf(' - Locator: ') == 0) {
                    errMsg += '\nWhile waiting for element with locator' + description;
                }
                let pendingTimeoutsPromise;
                if (this.trackOutstandingTimeouts_) {
                    pendingTimeoutsPromise = this.executeScriptWithDescription('return window.NG_PENDING_TIMEOUTS', 'Protractor.waitForAngular() - getting pending timeouts' + description);
                }
                else {
                    pendingTimeoutsPromise = selenium_webdriver_1.promise.fulfilled({});
                }
                let pendingHttpsPromise = this.executeScriptWithDescription(clientSideScripts.getPendingHttpRequests, 'Protractor.waitForAngular() - getting pending https' + description, this.rootEl);
                return selenium_webdriver_1.promise.all([pendingTimeoutsPromise, pendingHttpsPromise])
                    .then((arr) => {
                    let pendingTimeouts = arr[0] || [];
                    let pendingHttps = arr[1] || [];
                    let key, pendingTasks = [];
                    for (key in pendingTimeouts) {
                        if (pendingTimeouts.hasOwnProperty(key)) {
                            pendingTasks.push(' - $timeout: ' + pendingTimeouts[key]);
                        }
                    }
                    for (key in pendingHttps) {
                        pendingTasks.push(' - $http: ' + pendingHttps[key].url);
                    }
                    if (pendingTasks.length) {
                        errMsg += '. \nThe following tasks were pending:\n';
                        errMsg += pendingTasks.join('\n');
                    }
                    err.message = errMsg;
                    throw err;
                }, () => {
                    err.message = errMsg;
                    throw err;
                });
            }
            else {
                throw err;
            }
        });
    }
    /**
     * Waits for Angular to finish rendering before searching for elements.
     * @see webdriver.WebDriver.findElement
     * @returns {!webdriver.promise.Promise} A promise that will be resolved to
     *      the located {@link webdriver.WebElement}.
     */
    findElement(locator) {
        return this.element(locator).getWebElement();
    }
    /**
     * Waits for Angular to finish rendering before searching for elements.
     * @see webdriver.WebDriver.findElements
     * @returns {!webdriver.promise.Promise} A promise that will be resolved to an
     *     array of the located {@link webdriver.WebElement}s.
     */
    findElements(locator) {
        return this.element.all(locator).getWebElements();
    }
    /**
     * Tests if an element is present on the page.
     * @see webdriver.WebDriver.isElementPresent
     * @returns {!webdriver.promise.Promise} A promise that will resolve to whether
     *     the element is present on the page.
     */
    isElementPresent(locatorOrElement) {
        let element;
        if (locatorOrElement instanceof element_1.ElementFinder) {
            element = locatorOrElement;
        }
        else if (locatorOrElement instanceof selenium_webdriver_1.WebElement) {
            element = element_1.ElementFinder.fromWebElement_(this, locatorOrElement);
        }
        else {
            element = this.element(locatorOrElement);
        }
        return element.isPresent();
    }
    /**
     * Add a module to load before Angular whenever Protractor.get is called.
     * Modules will be registered after existing modules already on the page,
     * so any module registered here will override preexisting modules with the
     * same name.
     *
     * @example
     * browser.addMockModule('modName', function() {
     *   angular.module('modName', []).value('foo', 'bar');
     * });
     *
     * @param {!string} name The name of the module to load or override.
     * @param {!string|Function} script The JavaScript to load the module.
     *     Note that this will be executed in the browser context, so it cannot
     *     access variables from outside its scope.
     * @param {...*} varArgs Any additional arguments will be provided to
     *     the script and may be referenced using the `arguments` object.
     */
    addMockModule(name, script, ...moduleArgs) {
        this.mockModules_.push({ name: name, script: script, args: moduleArgs });
    }
    /**
     * Clear the list of registered mock modules.
     */
    clearMockModules() {
        this.mockModules_ = [];
        this.addBaseMockModules_();
    }
    /**
     * Remove a registered mock module.
     *
     * @example
     * browser.removeMockModule('modName');
     *
     * @param {!string} name The name of the module to remove.
     */
    removeMockModule(name) {
        for (let i = 0; i < this.mockModules_.length; ++i) {
            if (this.mockModules_[i].name == name) {
                this.mockModules_.splice(i--, 1);
            }
        }
    }
    /**
     * Get a list of the current mock modules.
     *
     * @returns {Array.<!string|Function>} The list of mock modules.
     */
    getRegisteredMockModules() {
        return this.mockModules_.map(module => module.script);
    }
    ;
    /**
     * Add the base mock modules used for all Protractor tests.
     *
     * @private
     */
    addBaseMockModules_() {
        this.addMockModule('protractorBaseModule_', clientSideScripts.protractorBaseModuleFn, this.trackOutstandingTimeouts_);
    }
    /**
     * @see webdriver.WebDriver.get
     *
     * Navigate to the given destination and loads mock modules before
     * Angular. Assumes that the page being loaded uses Angular.
     * If you need to access a page which does not have Angular on load, use
     * the wrapped webdriver directly.
     *
     * @example
     * browser.get('https://angularjs.org/');
     * expect(browser.getCurrentUrl()).toBe('https://angularjs.org/');
     *
     * @param {string} destination Destination URL.
     * @param {number=} opt_timeout Number of milliseconds to wait for Angular to
     *     start.
     */
    get(destination, timeout = this.getPageTimeout) {
        destination = this.baseUrl.indexOf('file://') === 0 ? this.baseUrl + destination :
            url.resolve(this.baseUrl, destination);
        let msg = (str) => {
            return 'Protractor.get(' + destination + ') - ' + str;
        };
        if (this.bpClient) {
            this.driver.controlFlow().execute(() => {
                return this.bpClient.setSynchronization(false);
            });
        }
        if (this.ignoreSynchronization) {
            this.driver.get(destination);
            return this.driver.controlFlow().execute(() => this.plugins_.onPageLoad()).then(() => { });
        }
        let deferred = selenium_webdriver_1.promise.defer();
        this.driver.get(this.resetUrl).then(null, deferred.reject);
        this.executeScriptWithDescription('window.name = "' + DEFER_LABEL + '" + window.name;' +
            'window.location.replace("' + destination + '");', msg('reset url'))
            .then(null, deferred.reject);
        // We need to make sure the new url has loaded before
        // we try to execute any asynchronous scripts.
        this.driver
            .wait(() => {
            return this
                .executeScriptWithDescription('return window.location.href;', msg('get url'))
                .then((url) => {
                return url !== this.resetUrl;
            }, (err) => {
                if (err.code == 13) {
                    // Ignore the error, and continue trying. This is
                    // because IE driver sometimes (~1%) will throw an
                    // unknown error from this execution. See
                    // https://github.com/angular/protractor/issues/841
                    // This shouldn't mask errors because it will fail
                    // with the timeout anyway.
                    return false;
                }
                else {
                    throw err;
                }
            });
        }, timeout, 'waiting for page to load for ' + timeout + 'ms')
            .then(null, deferred.reject);
        this.driver.controlFlow().execute(() => {
            return this.plugins_.onPageLoad();
        });
        // Make sure the page is an Angular page.
        this.executeAsyncScript_(clientSideScripts.testForAngular, msg('test for angular'), Math.floor(timeout / 1000), this.ng12Hybrid)
            .then((angularTestResult) => {
            let angularVersion = angularTestResult.ver;
            if (!angularVersion) {
                let message = angularTestResult.message;
                logger.error(`Could not find Angular on page ${destination} : ${message}`);
                throw new Error(`Angular could not be found on the page ${destination}. If this is not an ` +
                    `Angular application, you may need to turn off waiting for Angular. Please ` +
                    `see https://github.com/angular/protractor/blob/master/docs/timeouts.md#waiting-for-angular-on-page-load`);
            }
            return angularVersion;
        }, (err) => {
            throw new Error('Error while running testForAngular: ' + err.message);
        })
            .then(loadMocks, deferred.reject);
        let self = this;
        function loadMocks(angularVersion) {
            if (angularVersion === 1) {
                // At this point, Angular will pause for us until angular.resumeBootstrap is called.
                let moduleNames = [];
                for (const { name, script, args } of self.mockModules_) {
                    moduleNames.push(name);
                    let executeScriptArgs = [script, msg('add mock module ' + name), ...args];
                    self.executeScriptWithDescription.apply(self, executeScriptArgs)
                        .then(null, (err) => {
                        throw new Error('Error while running module script ' + name + ': ' + err.message);
                    })
                        .then(null, deferred.reject);
                }
                self.executeScriptWithDescription('window.__TESTABILITY__NG1_APP_ROOT_INJECTOR__ = ' +
                    'angular.resumeBootstrap(arguments[0]);', msg('resume bootstrap'), moduleNames)
                    .then(null, deferred.reject);
            }
            else {
                // TODO: support mock modules in Angular2. For now, error if someone
                // has tried to use one.
                if (self.mockModules_.length > 1) {
                    deferred.reject('Trying to load mock modules on an Angular2 app ' +
                        'is not yet supported.');
                }
            }
        }
        if (this.bpClient) {
            this.driver.controlFlow().execute(() => {
                return this.bpClient.setSynchronization(!this.internalIgnoreSynchronization);
            });
        }
        this.driver.controlFlow().execute(() => {
            return this.plugins_.onPageStable().then(() => {
                deferred.fulfill();
            }, deferred.reject);
        });
        return deferred.promise;
    }
    /**
     * @see webdriver.WebDriver.refresh
     *
     * Makes a full reload of the current page and loads mock modules before
     * Angular. Assumes that the page being loaded uses Angular.
     * If you need to access a page which does not have Angular on load, use
     * the wrapped webdriver directly.
     *
     * @param {number=} opt_timeout Number of milliseconds to wait for Angular to start.
     */
    refresh(opt_timeout) {
        if (this.ignoreSynchronization) {
            return this.driver.navigate().refresh();
        }
        return this
            .executeScriptWithDescription('return window.location.href', 'Protractor.refresh() - getUrl')
            .then((href) => {
            return this.get(href, opt_timeout);
        });
    }
    /**
     * Mixin navigation methods back into the navigation object so that
     * they are invoked as before, i.e. driver.navigate().refresh()
     */
    navigate() {
        let nav = this.driver.navigate();
        ptorMixin(nav, this, 'refresh');
        return nav;
    }
    /**
     * Browse to another page using in-page navigation.
     *
     * @example
     * browser.get('http://angular.github.io/protractor/#/tutorial');
     * browser.setLocation('api');
     * expect(browser.getCurrentUrl())
     *     .toBe('http://angular.github.io/protractor/#/api');
     *
     * @param {string} url In page URL using the same syntax as $location.url()
     * @returns {!webdriver.promise.Promise} A promise that will resolve once
     *    page has been changed.
     */
    setLocation(url) {
        this.waitForAngular();
        return this
            .executeScriptWithDescription(clientSideScripts.setLocation, 'Protractor.setLocation()', this.rootEl, url)
            .then((browserErr) => {
            if (browserErr) {
                throw 'Error while navigating to \'' + url + '\' : ' + JSON.stringify(browserErr);
            }
        });
    }
    /**
     * Returns the current absolute url from AngularJS.
     *
     * @example
     * browser.get('http://angular.github.io/protractor/#/api');
     * expect(browser.getLocationAbsUrl())
     *     .toBe('http://angular.github.io/protractor/#/api');
     * @returns {webdriver.promise.Promise<string>} The current absolute url from
     * AngularJS.
     */
    getLocationAbsUrl() {
        this.waitForAngular();
        return this.executeScriptWithDescription(clientSideScripts.getLocationAbsUrl, 'Protractor.getLocationAbsUrl()', this.rootEl);
    }
    /**
     * Adds a task to the control flow to pause the test and inject helper
     * functions
     * into the browser, so that debugging may be done in the browser console.
     *
     * This should be used under node in debug mode, i.e. with
     * protractor debug <configuration.js>
     *
     * @example
     * While in the debugger, commands can be scheduled through webdriver by
     * entering the repl:
     *   debug> repl
     *   > element(by.input('user')).sendKeys('Laura');
     *   > browser.debugger();
     *   Press Ctrl + c to leave debug repl
     *   debug> c
     *
     * This will run the sendKeys command as the next task, then re-enter the
     * debugger.
     */
    debugger() {
        // jshint debug: true
        this.driver.executeScript(clientSideScripts.installInBrowser);
        selenium_webdriver_1.promise.controlFlow().execute(() => {
            debugger;
        }, 'add breakpoint to control flow');
    }
    /**
     * See browser.explore().
     */
    enterRepl(opt_debugPort) {
        return this.explore(opt_debugPort);
    }
    /**
     * Beta (unstable) explore function for entering the repl loop from
     * any point in the control flow. Use browser.explore() in your test.
     * Does not require changes to the command line (no need to add 'debug').
     * Note, if you are wrapping your own instance of Protractor, you must
     * expose globals 'browser' and 'protractor' for pause to work.
     *
     * @example
     * element(by.id('foo')).click();
     * browser.explore();
     * // Execution will stop before the next click action.
     * element(by.id('bar')).click();
     *
     * @param {number=} opt_debugPort Optional port to use for the debugging
     * process
     */
    explore(opt_debugPort) {
        let debuggerClientPath = __dirname + '/debugger/clients/explorer.js';
        let onStartFn = (firstTime) => {
            logger.info();
            if (firstTime) {
                logger.info('------- Element Explorer -------');
                logger.info('Starting WebDriver debugger in a child process. Element ' +
                    'Explorer is still beta, please report issues at ' +
                    'github.com/angular/protractor');
                logger.info();
                logger.info('Type <tab> to see a list of locator strategies.');
                logger.info('Use the `list` helper function to find elements by strategy:');
                logger.info('  e.g., list(by.binding(\'\')) gets all bindings.');
                logger.info();
            }
        };
        this.debugHelper.initBlocking(debuggerClientPath, onStartFn, opt_debugPort);
    }
    /**
     * Beta (unstable) pause function for debugging webdriver tests. Use
     * browser.pause() in your test to enter the protractor debugger from that
     * point in the control flow.
     * Does not require changes to the command line (no need to add 'debug').
     * Note, if you are wrapping your own instance of Protractor, you must
     * expose globals 'browser' and 'protractor' for pause to work.
     *
     * @example
     * element(by.id('foo')).click();
     * browser.pause();
     * // Execution will stop before the next click action.
     * element(by.id('bar')).click();
     *
     * @param {number=} opt_debugPort Optional port to use for the debugging
     * process
     */
    pause(opt_debugPort) {
        if (this.debugHelper.isAttached()) {
            logger.info('Encountered browser.pause(), but debugger already attached.');
            return selenium_webdriver_1.promise.fulfilled(true);
        }
        let debuggerClientPath = __dirname + '/debugger/clients/wddebugger.js';
        let onStartFn = (firstTime) => {
            logger.info();
            logger.info('Encountered browser.pause(). Attaching debugger...');
            if (firstTime) {
                logger.info();
                logger.info('------- WebDriver Debugger -------');
                logger.info('Starting WebDriver debugger in a child process. Pause is ' +
                    'still beta, please report issues at github.com/angular/protractor');
                logger.info();
                logger.info('press c to continue to the next webdriver command');
                logger.info('press ^D to detach debugger and resume code execution');
                logger.info();
            }
        };
        this.debugHelper.init(debuggerClientPath, onStartFn, opt_debugPort);
    }
}
/**
 * @type {ProtractorBy}
 */
ProtractorBrowser.By = new locators_1.ProtractorBy();
exports.ProtractorBrowser = ProtractorBrowser;
//# sourceMappingURL=browser.js.map