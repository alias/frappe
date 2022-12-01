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

    attempts = frappe.cache().get_value(key)

    if attempts is None:
        attempts = 0

    frappe.cache().set_value(key=key, val=attempts + 1, user=None, expires_in_sec=expires_in_sec, cache_locally=False)

    if attempts == attempt_treshhold:
        print(f'occurance_checker attempt_treshhold ({attempt_treshhold}) reached for: {title}, attempt: {attempts}')
        monitor.send_event("cron.fetch_queue")

    if attempts >= attempt_treshhold:
        return True
    return False