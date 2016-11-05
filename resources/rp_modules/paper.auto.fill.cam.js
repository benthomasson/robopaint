/**
 * @file Path fill algortihm module: Export function for running the dynamic
 * "cam" style offset fill utilizing the "clipper" and cam.js libraries.
 */
/* globals _, rpRequire, i18n */

var ClipperLib = rpRequire('clipper');
var jscut = rpRequire('jscut')(ClipperLib);

// Global variable holder.
// TODO: Is there a better way to access/store module globals like this?
var g = {};

module.exports = {
  provides: ['cam'],
  fillPathStep: shapeFillPath,
  setup: function(globals) {
    // Populate the passed globals into the G object.
    _.each(globals, function(value, key) {
      g[key] = value;
    });
  },
  getStepMax: function(pathCount) {
    // One item = one step.
    return pathCount;
  },
  reset: function() {

  }
};

/**
 * Convert an incoming filled path into a set of cam paths.
 *
 * @param  {pathItem} inPath
 *  The fill path to work with.
 *
 * @return {Boolean}
 *   Whether we're not done with everything. False if done, true if not done.
 */
function shapeFillPath(inPath) {
  // 1. Copy the input path and flatten to a polygon (or multiple gons).
  // 2. Convert the polygon(s) points into the clipper array format.
  // 3. Delete the temp path.
  // 4. Run the paths array through jscut.
  // 5. Output the paths as a cam fill compound path.

  var p = inPath.clone();
  var geometries = [];
  var scale = 100000;
  var pxPerInch = 96;
  var spacing = g.settings.spacing / 5;

  // Is this a compound path?
  if (p.children) {
    _.each(p.children, function(c, pathIndex) {
      if (!c.length) return false;
      if (c.segments.length <= 1 && c.closed) {
         c.closed = false;
      }
      c.flatten(g.settings.flattenResolution);
      geometries[pathIndex] = [];
      _.each(c.segments, function(s){
        geometries[pathIndex].push({
          X: Math.round(s.point.x * scale / pxPerInch),
          Y: Math.round(s.point.y * scale / pxPerInch),
        });
      });
    });
  } else { // Single path.
    // With no path length, we're done.
    if (!p.length) {
      p.remove();
      inPath.remove();
      return true;
    }

    geometries[0] = [];
    p.flatten(g.settings.flattenResolution);
    _.each(p.segments, function(s){
      geometries[0].push({
        X: Math.round(s.point.x * scale / pxPerInch),
        Y: Math.round(s.point.y * scale / pxPerInch),
      });
    });
  }

  // Get rid of our temporary poly path
  p.remove();

  var cutConfig = {
    tool: {
      units: "inch",
      diameter: spacing / 25.4, // mm to inches
      stepover: 1
    },
    operation: {
      camOp: "Pocket",
      units: "inch",
      geometries: [geometries]
    }
  };

  var cutPaths = jscut.cam.getCamPaths(cutConfig.operation, cutConfig.tool);

  // If there's a result, create a compound path for it.
  if (cutPaths) {
    var pathString = jscut.cam.toSvgPathData(cutPaths, pxPerInch);
    var camPath = new g.CompoundPath(pathString);
    camPath.scale(1, -1); // Flip vertically (clipper issue)
    camPath.position = new g.Point(camPath.position.x, -camPath.position.y);

    // Make Water preview paths blue and transparent
    var isWater = inPath.data.color === 'water2';
    if (isWater) {
      g.paper.utils.setPathOption(camPath, {
        opacity: 0.5,
      });
    }

    g.paper.utils.setPathOption(camPath, {
      data: {
        color: inPath.data.color,
        name: inPath.data.name,
        type: 'fill',
      },
      strokeColor: isWater ? '#256d7b' : inPath.fillColor,
      strokeWidth: g.settings.lineWidth,
    });

    // Because we don't actually use compound paths in output, ungroup em.
    camPath.parent.insertChildren(0, camPath.removeChildren());


    inPath.remove();
    g.view.update();

    // Iterate steps and update progress.
    g.state.currentTraceChild++;
    g.state.totalSteps++;
    updateStatus();

    return true;
  } else { // Too small to be filled.
    // Iterate steps and update progress.
    g.state.currentTraceChild++;
    g.state.totalSteps++;
    updateStatus();

    inPath.remove();
    return true;
  }
}

function updateStatus() {
  if (g.mode) {
    g.mode.run('status',
      i18n.t('libs.spool.fill', {
        id: g.state.currentTraceChild + '/' + g.state.traceChildrenMax
      }),
      true
    );
    g.mode.run('progress', g.state.totalSteps);
  }
}
