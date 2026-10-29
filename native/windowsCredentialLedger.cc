#include <node_api.h>
#include <windows.h>
#include <wincred.h>
#include <string>
#include <vector>

static napi_value Fail(napi_env env) {
  napi_throw_error(env, "OS_LEDGER_UNAVAILABLE", "Protected revision ledger is unavailable; no fallback was used.");
  return nullptr;
}
static bool Target(napi_env env, napi_value value, std::wstring& target, bool qaOnly = false) {
  napi_valuetype type; size_t size = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string || napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size < 64 || size > 90) return false;
  std::vector<char> data(size + 1);
  if (napi_get_value_string_utf8(env, value, data.data(), data.size(), &size) != napi_ok) return false;
  const std::string text(data.data(), size), normal = "TeacherVaultLedgerV1-", qa = "TeacherVaultLedgerQAV1-";
  const std::string prefix = text.substr(0, qa.size()) == qa ? qa : normal;
  if ((qaOnly && prefix != qa) || text.size() != prefix.size() + 64 || text.substr(0, prefix.size()) != prefix) return false;
  for (size_t i = prefix.size(); i < text.size(); ++i) if (!((text[i] >= 'a' && text[i] <= 'f') || (text[i] >= '0' && text[i] <= '9'))) return false;
  target.assign(text.begin(), text.end()); return true;
}
static napi_value ReadImpl(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; std::wstring target;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 || !Target(env, argv[0], target)) return Fail(env);
  PCREDENTIALW credential = nullptr;
  if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
    if (GetLastError() == ERROR_NOT_FOUND) { napi_value empty; if (napi_get_null(env, &empty) != napi_ok) return Fail(env); return empty; }
    return Fail(env);
  }
  if (credential == nullptr) return Fail(env);
  napi_value result = nullptr;
  const bool valid = credential->Type == CRED_TYPE_GENERIC && credential->Persist == CRED_PERSIST_LOCAL_MACHINE && credential->CredentialBlobSize > 0 && credential->CredentialBlobSize <= 2048 && credential->CredentialBlob != nullptr;
  napi_status copied = valid ? napi_create_buffer_copy(env, credential->CredentialBlobSize, credential->CredentialBlob, nullptr, &result) : napi_invalid_arg;
  if (credential->CredentialBlob) SecureZeroMemory(credential->CredentialBlob, credential->CredentialBlobSize);
  CredFree(credential);
  return copied == napi_ok ? result : Fail(env);
}
static napi_value WriteImpl(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2]; std::wstring target; bool isBuffer = false; void* data = nullptr; size_t size = 0;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2 || !Target(env, argv[0], target) || napi_is_buffer(env, argv[1], &isBuffer) != napi_ok || !isBuffer || napi_get_buffer_info(env, argv[1], &data, &size) != napi_ok || size < 1 || size > 2048) return Fail(env);
  CREDENTIALW credential{};
  credential.Type = CRED_TYPE_GENERIC; credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  credential.TargetName = const_cast<wchar_t*>(target.c_str());
  credential.UserName = const_cast<wchar_t*>(L"TeacherVaultLocalLedger");
  credential.CredentialBlob = static_cast<LPBYTE>(data); credential.CredentialBlobSize = static_cast<DWORD>(size);
  if (!CredWriteW(&credential, 0)) return Fail(env);
  napi_value result; if (napi_get_undefined(env, &result) != napi_ok) return Fail(env); return result;
}
// No production deletion API: only isolated synthetic-native-CI targets qualify.
static napi_value RemoveSyntheticImpl(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; std::wstring target;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1 || !Target(env, argv[0], target, true)) return Fail(env);
  if (!CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0) && GetLastError() != ERROR_NOT_FOUND) return Fail(env);
  napi_value result; if (napi_get_undefined(env, &result) != napi_ok) return Fail(env); return result;
}
static napi_value Read(napi_env e, napi_callback_info i) { try { return ReadImpl(e, i); } catch (...) { return Fail(e); } }
static napi_value Write(napi_env e, napi_callback_info i) { try { return WriteImpl(e, i); } catch (...) { return Fail(e); } }
static napi_value RemoveSynthetic(napi_env e, napi_callback_info i) { try { return RemoveSyntheticImpl(e, i); } catch (...) { return Fail(e); } }
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {{"read", nullptr, Read, nullptr, nullptr, nullptr, napi_default, nullptr}, {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default, nullptr}, {"removeSynthetic", nullptr, RemoveSynthetic, nullptr, nullptr, nullptr, napi_default, nullptr}};
  if (napi_define_properties(env, exports, 3, properties) != napi_ok) return Fail(env);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
