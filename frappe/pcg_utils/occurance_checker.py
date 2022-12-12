import frappe
import hashlib

def occurance_checker(title:str, context: str = None, attempt_treshhold = 10, expires_in_sec=30):
    """
    Returns True if attempts >= attempt_treshhold.
    """
    import frappe.pcg_utils.monitor as monitor

    key = title
    if context is not None:
        key = f"{title}: {hashlib.md5((title + context).encode('utf-8')).hexdigest()}"

    attempts = frappe.cache().get_value(key, expires=True)

    if attempts is None:
        attempts = 0

    # test_before_key = frappe.cache().get_value(key, expires=True)
    new_attepts = attempts + 1
    frappe.cache().set_value(key=key, val=new_attepts, user=None, expires_in_sec=expires_in_sec)
    # test_after_key = frappe.cache().get_value(key, expires=True)
    # print(f'before: {test_before_key}, after: {test_after_key}, old_attempts: {attempts}, new_attempts: {new_attepts}')

    if attempts == attempt_treshhold:
        print(f'occurance_checker attempt_treshhold ({attempt_treshhold}) reached for: {title}, attempt: {attempts}')

    if attempts >= attempt_treshhold:
        return True
    return False