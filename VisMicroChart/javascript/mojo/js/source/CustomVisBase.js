(function () {

    mstrmojo.requiresCls("mstrmojo.VisBase",
        "mstrmojo.Widget",
        "mstrmojo.VisUtility",
        "mstrmojo.VisEnum",
        "mstrmojo.chart.model.enums.EnumDSSObjectType",
        "mstrmojo.vi.ui.rw._XtabDE",
        "mstrmojo.vi.ui.rw._HasVisSelections",
        "mstrmojo.vi.ui.rw.selectors._IsMultiUnitControl",
        "mstrmojo.vi.ui.rw.selectors._BrushesAndHighlights",
        "mstrmojo.Button",
        "mstrmojo.models.template.DataInterface",
        "mstrmojo.string",
        "mstrmojo.dom",
        "mstrmojo.array",
        "mstrmojo.DocDataService",
        "mstrmojo.hash",
        "mstrmojo.gm.GMUtility",
        "mstrmojo.func.composite",
        'mstrmojo._colorPalette'
    );

    var $DOM = mstrmojo.dom,
        $ARR = mstrmojo.array,
        $DSSOBJ_TYPES = mstrmojo.chart.model.enums.EnumDSSObjectType,
        $HASH = mstrmojo.hash,
        $NWB = mstrmojo.Button.newWebButton,
        $COMPOS = mstrmojo.func.composite,
        $FNEMPTY = mstrmojo.emptyFn,
        $UTIL = mstrmojo.VisUtility,
        $VIS_ENUM = mstrmojo.VisEnum,
        $GM_UTIL = mstrmojo.gm.GMUtility;

    var FILTER_TYPE = {
        SHARED: 0
    };

    var EXTERNAL_LIBS = {
        D3: 'd3'
    };

    function getErrorCtrlOverlay() {
        return [
            {
                scriptClass: 'mstrmojo.Label',
                cssClass: 'dropMsg',
                text: this.errorMessage + " " + this.errorDetails
            }
        ];
    }

    function toggleError(show) {
        this.raiseEvent({
            name: 'toggleCtrlOverlay',
            visible: show,
            controls: getErrorCtrlOverlay.call(this)
        });
    }

    /**
     * Hide the filter menu option by default.
     */
    function hideFilterMenuOption() {
        var vizContainer = this.parent,
            titleBar = vizContainer && vizContainer.titleBar,
            toolbarCfg = titleBar && titleBar.getMenuConfig();

        // Is there title bar?
        if (!toolbarCfg) {
            return;
        }

        // Filter out "Use as filter" option.
        toolbarCfg.menus = $ARR.filter(toolbarCfg.menus, function (item) {
            return item.cls !== 'uaf';
        });
    }

    /**
     * Read this.modelData.vp as the properties corresponding to the properties panel return the action.
     *
     * @returns {Array.<{act:String, v:String}>} action
     */
    function getSetPropertiesAction() {
        var modelData = this.model.data,
            xmlDom,
            xmlString;

        var convertJSONToXML = function (object, tagName) {
                var ret = xmlDom.createElement(tagName),
                    key;
                if (object instanceof Object) {
                    for (key in object) {
                        if (object.hasOwnProperty(key)) {
                            var child = convertJSONToXML(object[key], key);
                            if (child) {
                                ret.appendChild(child);
                            }
                        }
                    }
                } else {
                    ret.setAttribute('value', object);
                }
                return ret;
            },
            encodeXMLString = function (xmlString) {
                return xmlString.replace(/</g, "&lt;")
                    .replace(/"/g, "&quot;");
            };

        xmlDom = (new DOMParser()).parseFromString('<props><widgetProps><fmt></fmt></widgetProps></props>', 'text/xml');

        xmlDom.firstChild.firstChild.firstChild.appendChild(convertJSONToXML(this.getProperties(), 'cvp'));

        xmlString = (new XMLSerializer()).serializeToString(xmlDom);

        return [{
            act: 'setProperty',
            nodeKey: modelData.k,
            prs: 'FormattingWidget',
            pri: 4,
            v: encodeXMLString(xmlString)
        }];
    }

    /**
     * Helper function to check if the properties is valid to save in data.vp.cvp.
     *
     * @param {Object} properties
     * @param {Number} level
     *
     * @return {Boolean} Will return false if the properties is empty or has children that have more than 2 level.
     */
    function isValidProperties(properties, level) {
        var isObject = typeof properties === 'object';

        if ((level === 0 && !isObject) || (level === 2 && isObject)) {
            return false;
        }

        for (var key in properties) {
            var value = properties[key];
            if (typeof value === 'object' && !isValidProperties(value, level + 1)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Remember the reference of the external library.
     *
     * @param {Array} noConflictLibs
     */
    function reserveExternalLibrarys(noConflictLibs) {
        var _noConflictLibs = this._noConflictLibs,
            D3 = EXTERNAL_LIBS.D3;

        if (!_noConflictLibs) {
            _noConflictLibs = this._noConflictLibs = {};
        }

        $ARR.forEach(noConflictLibs, function (lib) {
            if (!_noConflictLibs[D3]) {
                switch (lib) {
                    case D3:
                        _noConflictLibs[D3] = window.d3;
                        return;
                }
            }
        });
    }

    /**
     * Generate the JS statement to redirect global reference for external library.
     *
     * @param {Array} noConflictLibraries
     * @returns {string}
     */
    function getNoConflictLibraryReference(noConflictLibraries) {
        var code = "",
            D3 = EXTERNAL_LIBS.D3;

        $ARR.forEach(noConflictLibraries, function (lib) {
            switch (lib) {
                case D3:
                    code += "var d3 = this._noConflictLibs['" + D3 + "'];";
                    return;
            }
        });

        return code;
    }

    /**
     * Base class for custom visualizations.
     *
     * @class
     * @extends mstrmojo.VisBase
     *
     * @mixes mstrmojo.vi.ui.rw._XtabDE
     */
    mstrmojo.CustomVisBase = mstrmojo.declare(
        mstrmojo.VisBase,

        [ mstrmojo.vi.ui.rw._XtabDE, mstrmojo.vi.ui.rw._HasVisSelections, mstrmojo.vi.ui.rw.selectors._IsMultiUnitControl, mstrmojo.vi.ui.rw.selectors._BrushesAndHighlights, mstrmojo._colorPalette],

        /**
         * @lends mstrmojo.CustomVisBase.prototype
         */
        {
            scriptClass: 'mstrmojo.CustomVisBase',

            plotted: false,

            markupString: '<div id="{@id}" class="custom-vis-layout {@cssClass}" style="position:absolute;font-size:8pt;width:{@width}px;height:{@height}px;z-index:{@zIndex};{@viewportCssText}" mstrattach:click,mousedown,mouseup,mousemove></div>',

            markupSlots: {
                containerNode: function () {
                    return this.domNode;
                },
                viewport: function () {
                    return this.domNode;
                }
            },

            formatHandlers: {
                viewport: [ 'background-color', 'left', 'top' ]
            },

            bindings: {
                gridData: 'this.model.data'
            },

            externalLibraries: null,

            /**
             * @type {Array.<String>}
             */
            cssFiles: null,

            errorMessage: "Either there is not enough data to display the visualization or the visualization configuration is incomplete.",

            errorDetails: "",

            isDynamicTooltip: true,

            reuseDOMNode: false,

            noConflictLibraries: null,

            /**
             * Holds grid data.
             *
             * @type {mstrmojo.models.template.DataInterface}
             */
            dataInterface: null,

            init: function init(props) {
                // Is this a VI visualization?
                if (window.mstrApp && window.mstrApp.isVI) {
                    // Are there viewport formatting handlers?
                    var viewportHandler = this.formatHandlers.viewport;
                    if (viewportHandler) {
                        // Does it have background color?
                        var idx = $ARR.indexOf(viewportHandler, 'background-color');
                        if (idx > -1) {
                            // Remove background color.
                            viewportHandler.splice(idx, 1);
                        }
                    }
                }

                this._super(props);

                // Are there CSS files to load?
                var cssFiles = this.cssFiles;
                if (cssFiles) {
                    // Insert CSS files.
                    mstrmojo.insertCSSLinks(cssFiles);
                }
            },

            /**
             * This function will be called during rendering.
             * Add your own code for drawing custom visualization to this function.
             */
            plot: mstrmojo.emptyFn,

            getFilterType: function getFilterType() {
                return this.defn.ins || FILTER_TYPE.SHARED;
            },

            unrender: function unrender(ignoreDom) {
                //Clear the cache.
                this.clearCache();

                //Call super.
                this._super(ignoreDom);
            },

            displayError: function displayError() {
                toggleError.call(this, true);
            },

            renderVisualization: function renderVisualization() {
                try {
                    toggleError.call(this, false);

                    this.dataInterface = new mstrmojo.models.template.DataInterface(this.getData());

                    // US49787: Isolate external libraries for custom viz. Replace the global reference in plot().
                    var noConflictLibraries = this.noConflictLibraries;
                    if (noConflictLibraries && noConflictLibraries.length > 0) {
                        var codeString = this.plot.toString();
                        eval(getNoConflictLibraryReference(noConflictLibraries) + codeString.substring(codeString.indexOf('{') + 1, codeString.lastIndexOf('}')));
                    } else {
                        this.plot();
                    }

                    this.plotted = true;

                } catch (e) {
                    this.displayError();
                    this.plotted = false;
                }
            },

            postBuildRendering: function postBuildRendering() {
                var me = this,
                    libraries,
                    res,
                    sub;

                // are we waiting for data from backend?
                if (me.waitingForData) {
                    return;
                }

                sub = me.listenToUpdateColorMap(function () {
                    me.render();
                    if (sub && me.detachUpdateColorMapListener instanceof Function) {
                        me.detachUpdateColorMapListener(sub);
                    }
                });
                hideFilterMenuOption.call(me);


                //Call super.
                res = this._super();

                // DE32268: Stop rendering if no data.
                var egt = this.model.data.egt;
                if (this.isEmpty() && (egt === undefined || egt === $VIS_ENUM.SERVER_JSON_ERROR_TYPE.AE_ERROR)) {
                    // There is no ctrlOverlay in express mode. Manually add it to children.
                    if (mstrApp.isExpress) {
                        this.addChildren(this.getVisEmptyMsgControls());

                        this.errorMsg.render();
                    }
                    return false;
                }

                // Are there libraries to load?
                libraries = (this.externalLibraries || []).concat();
                if (libraries) {
                    this.requiresExternalScripts(libraries, function () {

                        // US49787: Isolate external libraries for custom viz. Remember the newly loaded reference.
                        var noConflictLibraries = me.noConflictLibraries;
                        if (noConflictLibraries && noConflictLibraries.length > 0) {
                            reserveExternalLibrarys.call(me, noConflictLibraries);
                        }

                        me.renderVisualization();
                    });
                }else{
                    me.renderVisualization();
                }

                return res;
            },

            redraw: function redraw() {
                if (this.reuseDOMNode) {
                    if (this.plotted) {
                        this.renderVisualization();
                    }

                    return this.plotted;
                }

                return false;
            },

            moveTooltip: function moveTooltip(evt, win) {
                var target = evt.target || $DOM.eventTarget(evt.hWin, evt.e),
                    that = this,
                    content,
                    getTitle = function getTitle(node) {
                        var i,
                            children = node.childNodes;

                        for (i = 0; i < children.length; i++) {
                            var child = children[i];

                            if (child.nodeName === "title") {
                                return child;
                            }
                        }

                        if (node !== that.domNode) {
                            return getTitle(node.parentNode);
                        }

                        return null;
                    },
                    title = getTitle(target);

                if (title) {
                    var tooltip = title.innerHTML;

                    if (tooltip.length) {
                        content = tooltip;
                        title.tt = tooltip;
                        title.innerHTML = "";
                    } else if (title.tt !== undefined) {
                        content = title.tt;
                    }
                }

                this.richTooltip = {
                    posType: mstrmojo.tooltip.POS_TOPLEFT,
                    content: content,
                    top: evt.clientY + 12,
                    left: evt.clientX - 12,
                    cssClass: 'vi-regular vi-tooltip-A'
                };

                this._super(evt, win);
            },

            isEmpty: function isEmpty() {
                var data = this.model.data;

                return data.eg !== undefined || data.egt !== undefined;
            },

            getVisEmptyMsgControls: function getVisEmptyMsgControls() {
                var egt = this.model.data.egt;

                return this.isEmpty() ? (
                        ((egt === undefined || egt === $VIS_ENUM.SERVER_JSON_ERROR_TYPE.AE_ERROR)) ? [
                                {
                                    scriptClass: 'mstrmojo.Widget',
                                    cssClass: 'error-msg',
                                    alias: 'errorMsg',
                                    markupString: $UTIL.getVisEmptyMsg("AE_ERROR")
                                }
                            ] : getErrorCtrlOverlay.call(this)
                    ) : this._super();
            },

            /**
             * Return the properties object from data.vp.
             *
             * @returns {Object}
             */
            getProperties: function getProperties() {
                var data = this.model.data,
                    vp = data.vp;

                // Ensure the existing of data.vp.cvp.
                if (!vp) {
                    data.vp = {cvp : {}};
                } else if (!vp.cvp) {
                    vp.cvp = {};
                }

                return data.vp.cvp;
            },

            getDefaultProperties: function getDefaultProperties() {
                return this.dvp || {};
            },

            setDefaultPropertyValues: function setDefaultPropertyValues(dvp) {
                if (dvp instanceof Object) {
                    this.dvp = dvp;
                } else {
                    this.dvp = {};
                }
            },

            /**
             * Return the value of a specific property.
             *
             * @param {String} propertyName
             * @returns {Object}
             */
            getProperty: function getProperty(propertyName) {
                var props = this.getProperties(),
                    defProps = this.getDefaultProperties(),
                    propValue;

                propValue =  props[propertyName] === undefined ? defProps[propertyName] : props[propertyName];

                if (typeof propValue === "object") {
                    propValue = $HASH.copy(props[propertyName], defProps[propertyName]);
                }

                return propValue;
            },

            /**
             * Write a property to server.
             *
             * @param {String} propertyName Property name
             * @param {*} newValue Any JavaScript value
             * @param {{
             *     callback: {Function},
             *     suppressData: {Boolean},
             *     requestDefinition: {Object},
             *     clientUndoRedoCallback: {Function}
             * }} config
             */
            setProperty: function setProperty(propertyName, newValue, config) {
                var properties = this.getProperties(),
                    oldValue = properties[propertyName];

                // Is value changed?
                if (properties && !$HASH.equals(oldValue, newValue)) {
                    // Update the value in modelData.vp.
                    properties[propertyName] = newValue;

                    // Call onPropertyChange() to change multiple relative properties at once.
                    if (config && config.onPropertyChange instanceof Function) {
                        var changedProperties = config.onPropertyChange(propertyName, newValue);
                        if (isValidProperties(changedProperties, 0)) {
                            $HASH.copy(changedProperties, properties);
                        } else {
                            mstrmojo.warn(
                                "Results of onPropertyChange() is invalid. It must be an JSON object that contains the properties and values you want to change, and can't have child properties that exceeds two levels.",
                                {},
                                {
                                    buttons: [
                                        $NWB(mstrmojo.desc(1442, 'OK'), mstrmojo.emptyFn)
                                    ]
                                }
                            );
                        }
                    }

                    var suppressData = !!(config && config.suppressData),
                        requestDefinition = config && config.requestDefinition,
                        customUndoRedoCallback = config && config.clientUndoRedoCallback,
                        hasClientUndoRedoCallback = customUndoRedoCallback && (customUndoRedoCallback instanceof Function),
                        me = this,
                        visId = me.id,
                        boxId = me.parent.id,
                        visModel = me.model,
                        docModel = visModel.docModel,
                        controller = visModel.controller,
                        actions = getSetPropertiesAction.call(this),
                        callback,
                        undoredoCallback,
                        extra = {},
                        execute;

                    // A helper function to get client undo redo callback.
                    var getClientUndoRedoCallback = function getClientUndoRedoCallback(val) {
                        return hasClientUndoRedoCallback ? function () {
                                var vis = mstrmojo.all[visId],
                                    properties = vis.getProperties();
                                // Update the value in modelData.vp.
                                properties[propertyName] = val;
                                // Call custom undo redo call back.
                                customUndoRedoCallback.call(vis, val);
                                // Refresh property panel to reflect change.
                                vis.getDocModel().selectVIUnit(vis.parent.id, true);
                            } : $FNEMPTY;
                    };

                    // Is it suppressing data?
                    if (suppressData) {
                        callback = mstrmojo.emptyFn;
                        execute = function () {
                            this.submitSilent(actions);
                        };
                    } else {
                        callback = docModel.getSliceCallback({tks: visModel.data.k});
                        // Refresh property panel to reflect change.
                        callback.success = $COMPOS([callback.success, function () {
                            docModel.selectVIUnit(boxId, true);
                        }]);
                        execute = function () {
                            this.submit(actions, callback, extra);
                        };
                    }

                    // Get xTab call back for partial update.
                    undoredoCallback = controller._getXtabCallback(me);
                    // Refresh property panel to reflect change.
                    undoredoCallback.success = $COMPOS([undoredoCallback.success, function() {
                        docModel.selectVIUnit(boxId, true);
                    }]);

                    // Is it requesting definition?
                    if (requestDefinition) {
                        $HASH.copy(mstrmojo.DocDataService.REQUEST_DEFN_DATA, extra);
                    }

                    controller.cmdMgr.execute({
                        execute: execute,
                        urInfo: {
                            silent: hasClientUndoRedoCallback,
                            callback: undoredoCallback,
                            redo: getClientUndoRedoCallback(newValue),
                            undo: getClientUndoRedoCallback(oldValue)
                        }
                    });
                }
            },

            /**
             * Add Threshold menu item in drop zone context menu.
             */
            addThresholdMenuItem: function addThresholdMenuItem() {
                // Add a flag that drop zones can read.
                // Used at BaseVisDropZones.
                this.showThreshold = true;
            },

            /**
             * Add Use as Filter menu item in context menu.
             */
            addUseAsFilterMenuItem: function addUseAsFilterMenuItem() {
                var vizContainer = this.parent;

                if (vizContainer && vizContainer.generateToolbar) {
                    vizContainer.generateToolbar();
                }
            },

            getColorBy: function getColorBy(eids) {
                if(!eids || !this.zonesModel) {
                    return null;
                }
                var zoneItems = this.zonesModel.getColorByAttributes(),
                    colorObj,
                    gts = this.dataInterface.data.gts,
                    tids = [],
                    attr = $DSSOBJ_TYPES.DssTypeAttribute;
                $ARR.forEach(gts.row.concat(gts.col), function(item) {
                    $ARR.forEach(zoneItems, function(itm) {
                        //process attributes only
                        if((itm.otp === attr || itm.t === attr) && itm.id === item.id) {
                            tids.push(itm.id);
                        }
                    });
                });
                colorObj = this.model.docModel.getColorBy(tids, eids);
                return $GM_UTIL.decodeColor(colorObj.color);
            },

            getColorByAttInfo: function getColorByAttInfo(zoneItems) {
                function getShapeColorAndOpacity(cbElements) {
                    var me = this,
                        colorObj,
                        tid,
                        eid,
                        strtid,
                        streid,
                        attr,
                        opacity,
                        props = this.props || {},
                        opacities = props.attrColorByOpacity || {};
                    cbElements.map(function(item) {
                        tid = item.colorByAttributeIDs;
                        eid = item.colorByElementIDs;
                        strtid = tid && tid.join('|');
                        streid = eid && eid.join('|');
                        attr = opacities[strtid] || {};
                        opacity = attr && attr[streid];
                        if (opacity === undefined) {
                            opacity = 100; // default opacity
                        }
                        item.opacity = opacity;
                        if(tid && eid) {
                            colorObj = me.model.docModel.getColorBy(tid, eid);
                            item.color = $GM_UTIL.decodeColor(colorObj.color);
                        }
                    });
                }

                function getCbElements(zoneItems) {
                    var cbElements,
                        cbAtt = [],
                        gts = this.dataInterface.data.gts;
                    $ARR.forEach(zoneItems, function(item) {
                        $ARR.forEach(gts.row.concat(gts.col), function(itm) {
                            if(itm.otp === 12 && itm.id === item.id) {
                                cbAtt.push(itm);
                            }
                        });
                    });
                    function descartes(arr) {
                        var rs = [],
                            len = arr.length,
                            m,
                            str,
                            bothDescartes = function (arr1, arr2) {
                                var r =[],
                                    i,
                                    j,
                                    idx = 0,
                                    len1 = arr1.length,
                                    len2 = arr2.es.length;
                                for(i = 0; i< len1; i++) {
                                    for(j = 0; j < len2; j++) {
                                        str = arr1[i].text+' '+ arr2.es[j].n;
                                        idx++;
                                        r.push({
                                            comb: arr1[i].comb.concat({eid: arr2.es[j].id, tid: arr2.id}),
                                            colorByAttributeIDs: arr1[i].colorByAttributeIDs.concat(arr2.id),
                                            colorByElementIDs: arr1[i].colorByElementIDs.concat(arr2.es[j].id),
                                            text: str
                                        });
                                    }
                                }
                                return r;
                            };
                        for(m = 0; m < len; m++) {
                            if(m === 0) {
                                $ARR.forEach(arr[0].es, function(itm) {
                                    rs.push({
                                        comb: [{tid: arr[0].id, eid: itm.id}],
                                        colorByAttributeIDs: [arr[0].id],
                                        colorByElementIDs: [itm.id],
                                        text: itm.n
                                    });
                                });
                            }else{
                                rs = bothDescartes(rs, arr[m]);
                            }
                        }
                        return rs;
                    }
                    cbElements = descartes(cbAtt);
                    cbElements.unshift({
                        text: mstrmojo.desc(2461, 'All'),
                        color: '#ffffff',
                        opacity: 100,
                        comb: []
                    });
                    return cbElements;
                }
                var cbElements = getCbElements.call(this, zoneItems);
                getShapeColorAndOpacity.call(this,cbElements);
                return cbElements;
            },

            /**
             * Add selection to filter/highlight a unit/metric.
             *
             * @param {Array|Object} selectInfo
             */
            applySelection: function addSelection(selectInfo) {

                // Is there select information?
                if (!selectInfo) {
                    return;
                }

                var me = this;

                // Clear previous selections.
                this.clearSelections();

                $ARR.forEach($ARR.ensureArray(selectInfo), function (selection) {
                    // Is this selecting an attribute?
                    if (selection.isSelectAttr) {
                        me.addAttributeSelection(selection.tid, selection.eid, selection.name);
                    } else {
                        me.addMetricValueSelection(selection);
                    }
                });

                // Finish and submit the selection.
                this.endSelections();
            }
        }
    );

    /**
     * An enum for external types that is supported for no conflict.
     *
     * @type {Object}
     */
    mstrmojo.CustomVisBase.ENUM_EXTERNAL_LIBS = EXTERNAL_LIBS;
}());
/**
 * Created by DOGA on 5.1.2017.
 */
