// Modules required only on main thread
import deferredModules from './deferred';

import {mat4, vec3} from './utils/gl-matrix';
import ShaderProgram from './gl/shader_program';
import CanvasText from './styles/text/canvas_text';

Object.assign(deferredModules, { mat4, vec3, ShaderProgram, CanvasText });
