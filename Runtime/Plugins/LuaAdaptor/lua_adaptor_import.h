#pragma once

#include "stdint.h"
#include <stdlib.h>

/* value at a non-valid index */
#define NONVALIDVALUE		NULL//cast(TValue *, luaO_nilobject)

/* test for pseudo index */
#define ispseudo(i)		((i) <= LUA_REGISTRYINDEX)

#if LOCAL_DEBUG_USE_LUA_VERSION == 503
#include "lua53/lua.h"
#include "lua53/lobject.h"
#include "lua53/lstate.h"
#include "lua53/lfunc.h"
#include "lua53/lapi.h"
#include "lua53/lstring.h"
#include "lua53/ltable.h"
#include "lua53/lauxlib.h"
#elif LOCAL_DEBUG_USE_LUA_VERSION == 501
#include "lua51/lua.h"
#include "lua51/lobject.h"
#include "lua51/lstate.h"
#include "lua51/lfunc.h"
#include "lua51/lapi.h"
#include "lua51/lstring.h"
#include "lua51/ltable.h"
#include "lua51/lauxlib.h"
#elif __EMSCRIPTEN__
//EMSCRIPTEN_ENV_LUA_IMPORT_LOGIC_START
//EMSCRIPTEN_ENV_LUA_IMPORT_LOGIC_END
#endif
