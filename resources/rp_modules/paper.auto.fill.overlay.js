/**
 * @file Path fill algortihm module: Export function for running the overlay
 * path fill (overlaying a given large space filling path over the fill object).
 */
/* globals i18n, _ */

// State variables.
var overlayPathPos = 0; // Position on current tracing path
var lastGood = false; // Keep track if the last hit was good
var tracePaths = [];
var tpIndex = 0; // Current tracePath.
var overlayInts = null;
var spiralPath = null;

// Global variable holder.
// TODO: Is there a better way to access/store module globals like this?
var g = {};

module.exports = {
  provides: ['overlay'],
  fillPathStep: overlayLineFillNext,
  setup: function(globals) {
    // Populate the passed globals into the G object.
    _.each(globals, function(value, key) {
      g[key] = value;
    });

    // Overlay setup.
    g.settings.hatch = false; // No hatch on overlay

    spiralPath = new g.Path();

    // The spacing value is double the value in the fill settings menu
    // 10 (20 here) is the default fill spacing in the fill settings menu
    var spacing = g.settings.spacing / 5;

    // This is the diagonal distance of the area in which we will be filling
    // paths. We will never be filling of g.view.bounds; by ensuring the radius of the
    // spiral is larger than this distance we ensure that when we reach the end
    // of the spiral we have checked the entire printable area.
    var boundsSize = g.view.bounds.topLeft.getDistance(g.view.bounds.bottomRight);

    // Estimate the number of turns based on the spacing and boundsSize
    // Add 1 to compensate for the points we remove from the end
    var turns = Math.ceil(boundsSize / (spacing * 2 * Math.PI)) + 1;

    spiralPath.addSegments(makeSpiral(turns, spacing));

    while (!spiralOutsideBounds(spiralPath, g.view.bounds)) {
      spiralPath.addSegments(makeSpiral(turns * 2, spacing, turns));
      turns *= 2;
    }

    if (g.settings.debug) {
      var spiralSize = spiralPath.position.getDistance(spiralPath.lastSegment.point);
      var predictedTurns = Math.ceil(boundsSize / (spacing * 2 * Math.PI)) + 1;
      console.log(`Spiral generation finished with ${turns} turns, predicted ` +
        `${predictedTurns} turns, ${spiralSize} spiral distance, and ` +
        `${boundsSize} bounds distance`);
    }

    spiralPath.smooth();

    // The last few segments are not spiralular so remove them
    spiralPath.removeSegments(spiralPath.segments.length - 4);

    g.settings.traceIterationMultiplier*= 2;
  },
  getStepMax: function(pathCount) {
    // 2 steps for fill: lines & groups.
    return pathCount * 2;
  },
  reset: function() {
    spiralPath.remove();
    spiralPath = null;
    overlayPathPos = 0;
    lastGood = false;
    tracePaths = [];
    tpIndex = 0;
    overlayInts = null;
  }
};

function spiralOutsideBounds(spiral, bounds) {
  var spiralSize = spiral.position.getDistance(spiral.lastSegment.point);
  var boundsSize = bounds.topLeft.getDistance(bounds.bottomRight);
  return spiralSize > boundsSize;
}

function makeSpiral(turns, spacing, start) {
  var start = start ? start * Math.PI * 2 : 0;
  var points = [];
  var stepAngle = Math.PI / 4; // We want at least 8 points per turn

  for (var i = start; i < turns * Math.PI * 2; i += stepAngle) {
    points.push(calculateSpiral(i, spacing));
  }

  return points;
}

function calculateSpiral(distance, spacing) {
  var spacing = spacing ? spacing : 1;

  var x = spacing * distance * Math.cos(distance);
  var y = spacing * distance * Math.sin(distance);

  return {x: x, y: y};
}


// Dyanamic line fill iterative function (called from traceFillNext)
function overlayLineFillNext(fillPath) {
  var overlayPath = g.settings.overlayFillPath;
  overlayPath = overlayPath ? overlayPath : spiralPath;

  var tmp = g.paper.canvas.tempLayer;

  if (g.settings.debug) {
    overlayPath.strokeWidth = 2;
    overlayPath.strokeColor = "red";
  }

  // This happens only once per fillPath, at the very start:
  if (overlayInts === null) {
    // Align to path or to view?
    if (g.settings.overlayFillAlignPath) {
      overlayPath.position = fillPath.position;
    } else {
      overlayPath.position = g.view.center;
    }

    // Save the intersections
    overlayInts = overlayPath.getIntersections(fillPath);
  }

  // Current trace path doesn't exist? Make it!
  if (!tracePaths[tpIndex]) {
    tracePaths[tpIndex] = new g.Path({
      strokeColor: fillPath.fillColor,
      data: {
        color: fillPath.data.color,
        name: fillPath.data.name,
        type: 'fill'
      },
      strokeWidth: g.settings.lineWidth,
      strokeCap: 'round',
      miterLimit: 1
    });

    // Make Water preview paths blue and transparent
    if (tracePaths[tpIndex].data.color === 'water2') {
      tracePaths[tpIndex].strokeColor = '#256d7b';
      tracePaths[tpIndex].opacity = 0.5;
    }
  }

  var tracePath = tracePaths[tpIndex];

  // Check if the current point matches the hittest
  var testPoint = overlayPath.getPointAt(overlayPathPos);

  var h = tmp.hitTest(testPoint, {stroke: false, fill: true});

  // Standard fill/stroke checking: if the hit result item is the same as
  // our current path, keep going!
  var continueStroke = h ? (h.item === fillPath) : false;

  var closestID = -1;
  // If the above rules say we're to keep filling.. lets go!
  if (continueStroke) {
    // If we were outside of fillPath then move inside it add the closest
    // intersection to tracePath
    if (!lastGood && overlayPathPos !== 0) {
      closestID = g.getClosestIntersectionID(testPoint, overlayInts);
      tracePath.add(overlayInts[closestID].point);
    }

    tracePath.add(testPoint);
    lastGood = true;
  } else { // We're obstructed
    if (tracePath.segments.length) {
      tpIndex++; // Increment only if this path is used
    }

    lastGood = false;
  }

  // If we snapped to an intersection point, remove it from the list
  if (closestID !== -1) {
    overlayInts.splice(closestID, 1);
  }

  // Test to see if we're done filling the fillPath! =========================
  var pathComplete = false; // Assume we're not done

  // If we're fully beyond the fill boundaries on aligned path mode we're done
  if (g.settings.overlayFillAlignPath) {
    pathComplete = g.paper.utils.pointBeyond(testPoint, fillPath.bounds);
    if (pathComplete && g.settings.debug) {
      console.log('Completed overlay fill via outside bounds (slow).');
    }
  }

  // If we've gone beyond the length of the overlayPath... well, then we
  // likely didn't completely fill the darn thing.. oh well, better than an
  // error I suppose! :/
  if (!pathComplete &&
      overlayPathPos + g.settings.flattenResolution > overlayPath.length) {
    if (g.settings.debug) {
      console.log('Completed overlay fill via path length (sorry!).');
    }
    pathComplete = true;
  }

  // If we're completely out of overlayPath intersections.. we must be done!
  if (!pathComplete && overlayInts.length === 0) {
    pathComplete = true;
    if (g.settings.debug) {
      console.log('Completed overlay fill via intersection depletion (fast!).');
    }
  }

  // If we didn't normally hit the path, cheat till we do!
  if (!continueStroke && !pathComplete) {
    for (var i = 0; i < overlayInts.length; i++) {
      overlayPathPos = spiralPath.getOffsetOf(overlayInts[i].point);

      // Is the next step after this intersection inside the fillPath?
      var testPoint = overlayPath.getPointAt(overlayPathPos + g.settings.flattenResolution);
      var h = tmp.hitTest(testPoint, {stroke: false, fill: true});
      continueStroke = h ? (h.item === fillPath) : false;

      // If it is then we found an intersection where the spiral enters the fillPath
      if (continueStroke) {
        // remove the intersections we do not need
        overlayInts.splice(0, i - 1);
        break;
      }
    }

    // We did not find any more intersections that brought us inside the path
    if (!continueStroke) {
      if (g.settings.debug) {
        console.log('Completed overlay fill because no more intersections entered the path.');
      }
      pathComplete = true;
    }
  }

  // Did we complete the path?
  if (pathComplete) {
    if (g.state.currentTraceChild !== g.state.traceChildrenMax) {
      g.state.currentTraceChild++;
    }

    fillPath.remove();
    lastGood = false;
    overlayInts = null;
    overlayPathPos = 0;
    g.state.totalSteps++;
    if (tracePath.length > 0) { // Increment only if this path is used
      tpIndex++;
    } else { // If it wasn't used, can it so the next one gets a clean start.
      tracePath.remove();
      tracePaths[tpIndex] = null;
    }

    if (g.mode) {
      g.mode.run('status', i18n.t(
        'libs.spool.fill', {
          id: g.state.currentTraceChild + '/' + g.state.traceChildrenMax
        }
      ), true);
      g.mode.run('progress', g.state.totalSteps);
    }
  } else { // Next part of the path
    // Increment the path position.
    overlayPathPos+= g.settings.flattenResolution;

    if (overlayPathPos > overlayPath.length) {
      overlayPathPos = overlayPath.length;
    }
  }

  return true;
}
