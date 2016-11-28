// Modules required only on worker thread
import deferredModules from './deferred';

import * as topojson from 'topojson-client';
import Pbf from 'pbf';
import {VectorTile, VectorTileFeature} from 'vector-tile';
import geojsonvt from 'geojson-vt';

import {buildPolylines} from './builders/polylines';
import {buildPolygons, buildExtrudedPolygons} from './builders/polygons';
import {buildQuadsForPoints} from './builders/points';

import Collision from './labels/collision';
import placePointsOnLine from './labels/point_placement';
import TextSettings from './styles/text/text_settings';

Object.assign(deferredModules, {
    buildPolylines,
    buildPolygons,
    buildExtrudedPolygons,
    buildQuadsForPoints,
    topojson,
    Pbf,
    VectorTile,
    VectorTileFeature,
    geojsonvt,
    Collision,
    TextSettings,
    placePointsOnLine
});
