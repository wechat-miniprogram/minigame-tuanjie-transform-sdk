#include "lua_adaptor_import.h"

#if LUA_VERSION_NUM == 501
static TValue* lua_index2addr(lua_State* L, int idx)
{
  CallInfo* ci = L->ci;
  if (idx > 0)
  {
    TValue* o = ci->func + idx;
    // api_check(L, idx <= ci->top - (ci->func + 1), "unacceptable index");
    if (o >= L->top) return NONVALIDVALUE;
    else return o;
  }
  else if (!ispseudo(idx))
  {
    /* negative index */
    // api_check(L, idx != 0 && -idx <= L->top - (ci->func + 1), "invalid index");
    return L->top + idx;
  }
  else if (idx == LUA_REGISTRYINDEX)
    return &G(L)->l_registry;
  else
  {
    /* upvalues */
    idx = LUA_REGISTRYINDEX - idx;
    // api_check(L, idx <= MAXUPVAL + 1, "upvalue index too large");
    if (iscfunction(ci->func))
      return NONVALIDVALUE;
    else
    {
      CClosure* func = &ci->func->value.gc->cl.c;
      return (idx <= func->nupvalues) ? &func->upvalue[idx - 1] : NONVALIDVALUE;
    }
  }
}


size_t lua_sizeof(lua_State* L, int idx){
  const char* tn = lua_typename(L, lua_type(L, -1));
  TValue* o = lua_index2addr(L, idx);
  if (!o)
    return 0;

  switch (ttype(o))
  {

  case LUA_TTABLE:
  {
    luaL_checkstack(L, LUA_MINSTACK, NULL);
    Table* h = hvalue(o);
    if (h == NULL) {
      return 0;
    }
    return (sizeof(Table) + sizeof(TValue) * h->sizearray +
            sizeof(Node) * (sizenode(h)));
  }
  case LUA_TFUNCTION:
  {
    if (iscfunction(o)) {
      return sizeCclosure(o->value.gc->cl.c.nupvalues);
    } else {
      return sizeLclosure(o->value.gc->cl.l.nupvalues);
    }
  }
  case LUA_TTHREAD:
  {
    lua_State* th = thvalue(o);

    return (sizeof(lua_State) + sizeof(TValue) * th->stacksize +
            sizeof(CallInfo) * th->size_ci);
  }
  case LUA_TPROTO:
  {
    Proto* p = (Proto*)pvalue(o);
    return (sizeof(Proto) +
            sizeof(Instruction) * p->sizecode +
            sizeof(Proto*) * p->sizep +
            sizeof(TValue) * p->sizek +
            sizeof(int) * p->sizelineinfo +
            sizeof(LocVar) * p->sizelocvars +
            sizeof(TString*) * p->sizeupvalues);
  }

  case LUA_TUSERDATA:
  {
    return sizeudata(uvalue(o));
  }
  case LUA_TSTRING:
  {
    TString* ts = &o->value.gc->ts;
    return sizeof(TString) + sizeof(char) * ts->tsv.len + 1;
  }
  case LUA_TNUMBER:
  {
    return sizeof(lua_Number);
  }
  case LUA_TBOOLEAN:
  {
    return sizeof(int);
  }
  case LUA_TLIGHTUSERDATA:
  {
    return sizeof(void*);
  }
  default: return (size_t)(0);
  }
}


uintptr_t lua_getaddr(lua_State* L, int idx) {
  TValue* o = lua_index2addr(L, idx);
  if (!o)
    return (uintptr_t)(lua_topointer(L, -1));

  switch (ttype(o))
  {
  case LUA_TPROTO:
  {
    return (uintptr_t)(pvalue(o));
  }
  case LUA_TSTRING:
  {
    return (uintptr_t)(getstr(o));
  }
  case LUA_TTABLE:
  case LUA_TFUNCTION:
  case LUA_TTHREAD:
  case LUA_TUSERDATA:
  case LUA_TLIGHTUSERDATA:
  default: {
    return (uintptr_t)(lua_topointer(L, -1));
  }
  }
}


int  (lua_getuservalue) (lua_State *L, int idx) {
  lua_pushnil(L);
}

#endif