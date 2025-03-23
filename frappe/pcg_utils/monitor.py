import socket
import time
import frappe
from frappe.pcg_utils.occurance_checker import occurance_checker

class Monitor:
    """ encapsulate sending stuff to the rrd monitor. Thats a carbon/whisper/graphite system
        with a rrd scheme 1m:2d,15m:35d,1h:2y,1d:5y
        One can send (ever increasing) counters, events (summing up per minute) or gauge values (averaging per minute)

        Use the class instance if you have a special base name, server name or performance reasons
     """

    MONITOR = "159.69.55.13"                     # well known monitor.oekobox-online.de, UDP 
    PORT=2004                                    # 2004: aggregating, 2003: raw (you have to make sure to aggregate < 1min)    site
    PREFIX = "unset."
                                                 # prefix needs to be whitlisted 

    def __init__(self, basename=None, server=None, port=None):
        """ basename may override the pcg.<servername>.<tenant> default """
        
        basepath = frappe.utils.get_site_base_path()[2:]
        dotinx = basepath.find('.')
        if dotinx > -1:                       # reduce lenz.live.pcgteam.net to lenz
            basepath = basepath[0:dotinx]

        self.PREFIX = "pcg." + socket.gethostname() + "." + basepath + "."

        self.DEVELOPER_MODE = frappe.conf.developer_mode == 1 or "localhost" in self.PREFIX

        if basename is not None:
            self.PREFIX = basename + "."
        if server is not None:
            self.MONITOR = server
        if port is not None:
            self.PORT = port

    def __send_internal(self, core_msg):        
        DT = round(time.time()) 
        msg = self.PREFIX + core_msg + " " + str(DT)
        # avoid flooding the monitor database with test systems
        if self.DEVELOPER_MODE:                 
            return
        
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.sendto(msg.encode(),(self.MONITOR, self.PORT))

    def send_event(self, event_name, count=1):
        """ an event (.._C) uses an sum aggregation scheme """               
        self.__send_internal(event_name + "_E " + str(count) )

    def send_counter(self, event_name, count=1):
        """ an counter (.._C) uses an sum aggregation scheme, but is assumed to be ever increasing """               
        self.__send_internal(event_name + "_C " + str(count) )

    def send_gauge(self, event_name, count=1):
        """ an counter (no postfix) uses an sum aggregation scheme, but is assumed to be ever increasing """               
        self.__send_internal(event_name + "_G " + str(count) )
        

def send_event(event_name, count=1):
    """shortcut to send events with default settings"""
    Monitor().send_event(event_name, count)

def send_counter(event_name, count=1):
    """shortcut to send counter vals with default settings"""
    Monitor().send_counter(event_name, count)

def send_gauge(event_name, count):
    """shortcut to send gauge vals with default settings"""
    Monitor().send_gauge(event_name, count)

# if ever needed
#def send_direct(event_name, value):
    #"""know what you are doing"""
    #Monitor(port=2003).__send_internal(event_name + " " + str(value))