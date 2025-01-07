#include "lua_adaptor_import.h"

lua_Debug* lua_newdebugar() { return malloc(sizeof(lua_Debug)); }
void lua_deletedebugar(lua_Debug* ar) { return free(ar); }

const char* lua_Debug_getname(lua_Debug* ar) { return ar->name; }
char* lua_Debug_getshortsrc(lua_Debug* ar) { return ar->short_src; }
int lua_Debug_getevent(lua_Debug* ar) { return ar->event; }
int lua_Debug_getlinedefined(lua_Debug* ar) { return ar->linedefined; }
int lua_Debug_getlastlinedefined(lua_Debug* ar) { return ar->lastlinedefined; }

int lua_get_registry_index() { return LUA_REGISTRYINDEX; }
double lua_todouble(lua_State *L, int idx) { return (double)lua_tonumber(L, idx); }


lua_State* lua_State_getmainthread(lua_State* L) { return G(L)->mainthread; }

void (lua_do_sethook) (lua_State *L, lua_Hook func, int mask, int count) {
  lua_sethook(L, func, mask, count);
}
