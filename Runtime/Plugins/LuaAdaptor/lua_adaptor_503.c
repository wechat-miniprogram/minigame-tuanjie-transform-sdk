#include "lua_adaptor_import.h"

#if LUA_VERSION_NUM == 503

#define GETTVALUE(v) v
#define tvtype(o) ttnov(o)
#define LUA_PROTO LUA_TPROTO
#define LUA_UPVAL LUA_TUPVAL
#define LUA_TABLE LUA_TTABLE
#define LUA_THREAD LUA_TTHREAD
#define LUA_USERDATA LUA_TUSERDATA
#define LUA_LIGHTUSERDATA LUA_TLIGHTUSERDATA
#define LUA_SHRSTR LUA_TSHRSTR
#define LUA_LNGSTR LUA_TLNGSTR
#define LUA_LCL LUA_TLCL
#define LUA_CCL LUA_TCCL
#define LUA_LCF LUA_TLCF
#define LUA_IS_LUA_C_FUNCTION(f) (ttislcf(f))
#define LUA_C_CLUSTER_VALUE(f) (clCvalue(f))

static TValue* lua_index2addr(lua_State* L, int idx)
{
  CallInfo* ci = L->ci;
  if (idx > 0)
  {
    TValue* o = GETTVALUE(ci->func + idx);
    api_check(L, idx <= ci->top - (ci->func + 1), "unacceptable index");
    if (o >= GETTVALUE(L->top)) return NONVALIDVALUE;
    else return o;
  }
  else if (!ispseudo(idx))
  {
    /* negative index */
    api_check(L, idx != 0 && -idx <= L->top - (ci->func + 1), "invalid index");
    return GETTVALUE(L->top + idx);
  }
  else if (idx == LUA_REGISTRYINDEX)
    return &G(L)->l_registry;
  else
  {
    /* upvalues */
    idx = LUA_REGISTRYINDEX - idx;
    api_check(L, idx <= MAXUPVAL + 1, "upvalue index too large");
    if (LUA_IS_LUA_C_FUNCTION(GETTVALUE(ci->func)))
      return NONVALIDVALUE;
    else
    {
      CClosure* func = LUA_C_CLUSTER_VALUE(GETTVALUE(ci->func));
      return (idx <= func->nupvalues) ? &func->upvalue[idx - 1] : NONVALIDVALUE;
    }
  }
}

uintptr_t lua_getaddr(lua_State* L, int idx) {
  TValue* o = lua_index2addr(L, idx);
  if (!o)
    return (uintptr_t)(lua_topointer(L, -1));

  switch (tvtype(o))
  {
  case LUA_TPROTO:
  {
    return (uintptr_t)(pvalue(o));
  }
  case LUA_SHRSTR:
  case LUA_LNGSTR:
  {
    return (uintptr_t)(tsvalue(o));
  }
  case LUA_TTABLE:
  case LUA_LCL:
  case LUA_CCL:
  case LUA_LCF:
  case LUA_TTHREAD:
  case LUA_TUSERDATA:
  case LUA_TLIGHTUSERDATA:
  default: {
    return (uintptr_t)(lua_topointer(L, -1));
  }
  }
}

size_t lua_sizeof(lua_State* L, int idx){
  const char* tn = lua_typename(L, lua_type(L, -1));
  TValue* o = lua_index2addr(L, idx);
  if (!o)
    return 0;

  switch (tvtype(o))
  {

  case LUA_TABLE:
  {
    luaL_checkstack(L, LUA_MINSTACK, NULL);
    Table* h = hvalue(o);
    if (h == NULL) {
      return 0;
    }
    return (sizeof(Table) + sizeof(TValue) * h->sizearray +
            sizeof(Node) * (isdummy(h) ? 0 : sizenode(h)));
  }
  case LUA_LCL:
  {
    LClosure* cl = clLvalue(o);
    return sizeLclosure(cl->nupvalues);
  }
  case LUA_CCL:
  {
    CClosure* cl = clCvalue(o);
    return sizeCclosure(cl->nupvalues);
  }
  case LUA_TTHREAD:
  {
    lua_State* th = thvalue(o);

    return (sizeof(lua_State) + sizeof(TValue) * th->stacksize +
            sizeof(CallInfo) * th->nci);
  }
  case LUA_PROTO:
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

  case LUA_USERDATA:
  {
    return sizeudata(uvalue(o));
  }
  case LUA_SHRSTR:
  {
    TString* ts = gco2ts(o);
    return sizelstring(ts->shrlen);
  }
  case LUA_LNGSTR:
  {
    TString* ts = gco2ts(o);
    return sizelstring(ts->u.lnglen);
  }
  case LUA_TNUMBER:
  {
    return sizeof(lua_Number);
  }
  case LUA_TBOOLEAN:
  {
    return sizeof(int);
  }
  case LUA_LIGHTUSERDATA:
  {
    return sizeof(void*);
  }
  default: return (size_t)(0);
  }
}

#endif