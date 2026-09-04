import os
import platform
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import ClassVar

import requests

import frappe
from frappe import _
from frappe.utils.data import cint
from frappe.utils.print_utils import find_or_download_chromium_executable

IS_WINDOWS = platform.system().lower() == "windows"


PR_SET_PDEATHSIG = 1

if IS_WINDOWS:
	_LIBC = None
else:
	import ctypes
	import ctypes.util

	try:
		_LIBC = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
	except OSError:
		_LIBC = None


def _die_with_parent():
	"""Ask the kernel to kill this child as soon as its parent goes away.

	Runs in the forked child between fork and exec, so it must not do anything that
	could take a lock the parent held at fork time — libc is therefore loaded at
	import, not here.

	Without this, a worker that dies hard — RQ job timeout, OOM kill, docker stop —
	never gets to run any cleanup, and its Chromium keeps running with nobody left
	who knows about it.
	"""
	if _LIBC is not None:
		_LIBC.prctl(PR_SET_PDEATHSIG, signal.SIGKILL)


def _signal_tree(proc, sig):
	"""Signal the whole process group, not just the browser process.

	Chromium is a tree: browser, two zygotes, GPU and network. `Popen.terminate()`
	signals the browser alone, so the children outlive it whenever the browser does
	not get to shut them down itself.
	"""
	if IS_WINDOWS:
		proc.send_signal(sig)
		return
	try:
		os.killpg(os.getpgid(proc.pid), sig)
	except (ProcessLookupError, PermissionError, OSError):
		try:
			proc.send_signal(sig)
		except ProcessLookupError:
			pass


def _terminate_and_reap(proc, timeout=5):
	"""Terminate a Chromium tree and collect its exit status.

	Returns True if this call did the terminating. `wait()` matters as much as the
	signal: without it the browser stays behind as a zombie on the worker, which is
	how the leak first showed up in the process list.
	"""
	if proc.poll() is not None:
		proc.wait()
		return False

	_signal_tree(proc, signal.SIGTERM)
	try:
		proc.wait(timeout=timeout)
	except subprocess.TimeoutExpired:
		_signal_tree(proc, signal.SIGKILL)
		proc.wait()
	return True


def _drain(stream):
	"""Read a pipe to EOF in the background so the writer never blocks on a full one."""
	if not stream:
		return

	def run():
		try:
			for _line in stream:
				pass
		except (ValueError, OSError):
			pass

	threading.Thread(target=run, daemon=True).start()


class ChromePDFGenerator:
	_instance = None

	_browsers: ClassVar[list] = []

	# Every Chromium this process has started, whether or not an instance still
	# points at it. Cleanup used to go through `self._chromium_process` alone and
	# reported success even when that attribute had already been set to None — the
	# process then survived unreferenced until the container was restarted. Killing
	# from the registry means a lost handle can no longer become a leaked process.
	_processes: ClassVar[list] = []

	def add_browser(self, browser):
		self._browsers.append(browser)

	def remove_browser(self, browser):
		if browser in self._browsers:
			self._browsers.remove(browser)

	def __new__(cls):
		# Rebuild singleton when chromium subprocess is missing or has exited.
		# subprocess.Popen stays truthy after the underlying process dies, so
		# `not cls._instance._chromium_process` never trips — use poll() instead.
		if (
			cls._instance is None
			or cls._instance._chromium_process is None
			or cls._instance._chromium_process.poll() is not None
		):
			cls._instance = super().__new__(cls)
		return cls._instance

	def __init__(self):
		"""Initialize only once."""
		if hasattr(self, "_initialized"):  # Prevent multiple initializations
			return
		self._initialized = True  # Mark as initialized

		self._chromium_process = None
		self._chromium_path = None
		self._devtools_url = None
		self._initialize_chromium()

	def _initialize_chromium(self):
		# ideally browser is initailized from before request hook.
		# if _chromium_process is not available then initialize it.
		if self._chromium_process:
			return
		# get site config and load chromium settings.
		site_config = frappe.get_common_site_config()

		# only when we want to chromium on separate docker / server ( not implemented/tested yet )
		self.CHROMIUM_WEBSOCKET_URL = site_config.get("chromium_websocket_url", "")
		if self.CHROMIUM_WEBSOCKET_URL:
			frappe.warn("Using external chromium websocket url. Make sure it is accessible.")
			self._devtools_url = self.CHROMIUM_WEBSOCKET_URL
			return

		"""
		Number of allowed open websocket connections to chromium.
		This number will basically define how many concurrent requests can be handled by one chromium instance.
		#TODO: Implement/Modify logic to handle multiple chromium instance in one class / per worker. currently we are starting one chromium.
		"""
		self.CHROME_OPEN_CONNECTIONS = site_config.get("chromium_max_concurrent", 1)
		# if we want to use persistent ( long running ) chromium for all sites.
		# current approch starts chrome per worker process.
		# TODO: Better Implement logic to support for persistent chrome proccess.
		self.USE_PERSISTENT_CHROMIUM = site_config.get("use_persistent_chromium", False)
		#  time to wait for chromium to start and provide dev tools url used in _set_devtools_url.
		self.START_TIMEOUT = site_config.get("chromium_start_timeout", 3)
		# Allow a single PDF request to opt into interactive Chromium debugging in developer mode only.
		self.debug_mode = frappe.conf.developer_mode and bool(frappe.form_dict.get("pdf_debug"))

		self._chromium_path = find_or_download_chromium_executable()
		if self._verify_chromium_installation():
			if not self._devtools_url:
				self.start_chromium_process(debug=self.debug_mode)

	def _verify_chromium_installation(self):
		"""Ensures Chromium is available and executable, raising clearer errors if not."""
		if not os.path.exists(self._chromium_path):
			frappe.throw(
				f"Chromium not available at the specified path. Please check the path: {self._chromium_path}"
			)
		if not os.access(self._chromium_path, os.X_OK):
			frappe.throw(f"Chromium not executable at {self._chromium_path}")
		return True

	def start_chromium_process(self, debug=False):
		"""
		Launches Chromium in headless mode with robust logging and error handling.
		chrome switches
		https://peter.sh/experiments/chromium-command-line-switches/

		NOTE: dbus issue in docker
		  https://source.chromium.org/chromium/chromium/src/+/main:content/app/content_main.cc;l=229-241?q=DBUS_SESSION_BUS_ADDRESS&ss=chromium
		"""
		try:
			if debug:
				command_args = [
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",  # path to locally installed chrome browser for debugging.
					"--remote-debugging-port=0",
					"--user-data-dir=/tmp/chromium-{}-user-data".format(
						frappe.local.site + frappe.utils.random_string(10)
					),
					"--disable-gpu",
					"--no-sandbox",
					"--no-first-run",
					"",
				]
			else:
				command_args = [
					self._chromium_path,
					# 0 will automatically select a random open port from the ephemeral port range.
					"--remote-debugging-port=0",
					"--disable-gpu",  # GPU is not available in production environment.
					"--disable-field-trial-config",
					"--disable-background-networking",
					"--disable-background-timer-throttling",
					"--disable-backgrounding-occluded-windows",
					"--disable-back-forward-cache",
					"--disable-breakpad",
					"--disable-client-side-phishing-detection",
					"--disable-component-extensions-with-background-pages",
					"--disable-component-update",
					"--no-default-browser-check",
					"--disable-default-apps",
					"--disable-dev-shm-usage",
					"--disable-extensions",
					"--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync,Translate,HttpsUpgrades,PaintHolding,ThirdPartyStoragePartitioning,LensOverlay,PlzDedicatedWorker",
					"--allow-pre-commit-input",
					"--disable-hang-monitor",
					"--disable-ipc-flooding-protection",
					"--disable-popup-blocking",
					"--disable-prompt-on-repost",
					"--disable-renderer-backgrounding",
					"--force-color-profile=srgb",
					"--metrics-recording-only",
					"--no-first-run",
					"--password-store=basic",
					"--use-mock-keychain",
					"--no-service-autorun",
					"--export-tagged-pdf",
					"--disable-search-engine-choice-screen",
					"--unsafely-disable-devtools-self-xss-warnings",
					"--enable-use-zoom-for-dsf=false",
					"--use-angle",
					"--headless",
					"--hide-scrollbars",
					"--mute-audio",
					"--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
					"--no-sandbox",
					"--no-startup-window",
					# related to HeadlessExperimental flag enable when Implement Deterministic rendering. check page class for more info.
					# "--enable-surface-synchronization",
					# "--run-all-compositor-stages-before-draw",
					# "--disable-threaded-animation",
					# "--disable-threaded-scrolling",
					# "--disable-checker-imaging",
				]

			self._start_chromium_process(command_args)

		except Exception as e:
			frappe.log_error(f"Error starting Chromium: {e}")
			frappe.throw(_("Could not start Chromium. Check logs for details."))

	# Apply the decorator to monitor Chromium subprocess usage for development / debugging purposes.
	# it will print and write usage data to a file ( defaults to chrome_process_usage.json).
	# from print_designer.pdf_generator.monitor_subprocess import monitor_subprocess_usage
	# @monitor_subprocess_usage(interval=0.1)
	def _start_chromium_process(self, command_args):
		if platform.system().lower() == "windows":
			# hide cmd window
			startupinfo = subprocess.STARTUPINFO()
			startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
			startupinfo.wShowWindow = subprocess.SW_HIDE
			self._chromium_process = subprocess.Popen(
				command_args,
				stdout=subprocess.PIPE,
				stderr=subprocess.PIPE,
				startupinfo=startupinfo,
				text=True,
			)
		else:
			self._chromium_process = subprocess.Popen(
				command_args,
				# nothing reads stdout, and a full pipe would block Chromium
				stdout=subprocess.DEVNULL,
				# stderr carries the DevTools URL, so it stays a pipe and gets drained
				# in _set_devtools_url once the URL has been read
				stderr=subprocess.PIPE,
				text=True,
				# own session, and with it an own process group, so the whole tree can be
				# signalled in one go (start_new_session rather than process_group=0,
				# which would raise on Python < 3.11)
				start_new_session=True,
				preexec_fn=_die_with_parent,
			)
		ChromePDFGenerator._processes.append(self._chromium_process)
		return self._chromium_process

	def _set_devtools_url(self):
		"""
		Monitor Chromium's stderr for the DevTools WebSocket URL
		----------------
		other approch: if we choose port using find_available_port we can avoid this entirely and fetch_devtools_url() method.

		NOTE:	1) in current approch output to stderr is pretty consistent.
		                2) other approch may seem reliable but it is slow compared to this in testing.

		TODO:
		final approch can be decided later after testing in production.
		"""
		stderr = self._chromium_process.stderr
		start_time = time.time()

		while time.time() - start_time < self.START_TIMEOUT:
			# Read a single line from stderr and check if it contains the DevTools URL.
			# Not using select() because it is not supported on Windows for non-socket file descriptors.
			line = stderr.readline()
			# not sure if "DevTools listening on" is consistent in all chromium versions.
			if "DevTools listening on" in line:
				url_start = line.find("ws://")
				if url_start != -1:
					self._devtools_url = line[url_start:].strip()
					# From here on nobody reads stderr again. Chromium keeps writing to
					# it, and a full 64K pipe buffer would block the browser mid-render.
					_drain(stderr)
					break

		if not self._devtools_url:
			_terminate_and_reap(self._chromium_process)
			if self._chromium_process in ChromePDFGenerator._processes:
				ChromePDFGenerator._processes.remove(self._chromium_process)
			self._chromium_process = None
			raise TimeoutError("Chromium took too long to start.")

	def _close_browser(self):
		"""
		Close every headless Chromium this process has started.

		Goes through the class registry rather than `self._chromium_process`, so a
		handle that was dropped somewhere along the way still gets its process killed.
		The log line reports what actually happened — the old unconditional "closed
		successfully" hid the leak for as long as it existed.
		"""
		if self._browsers:
			frappe.log("Cannot close Chromium as there are active browser instances.")
			return

		closed = 0
		for proc in list(ChromePDFGenerator._processes):
			try:
				if _terminate_and_reap(proc):
					closed += 1
			except Exception:
				frappe.log_error(f"Failed to close Chromium process {proc.pid}")
			finally:
				ChromePDFGenerator._processes.remove(proc)

		ChromePDFGenerator._instance = None
		self._chromium_process = None
		self._devtools_url = None
		if closed:
			frappe.log(f"Headless Chromium closed successfully ({closed}).")

	def detach_debug_browser(self):
		"""
		Detach the generator from an interactive debug Chromium process.

		This keeps the debug browser window available for inspection, while ensuring
		the next PDF request starts with a fresh generator/process instead of reusing
		the old debug session.
		"""
		# Drop it from the registry too, otherwise the next _close_browser() would
		# kill the very window this method exists to keep open.
		if self._chromium_process in ChromePDFGenerator._processes:
			ChromePDFGenerator._processes.remove(self._chromium_process)
		ChromePDFGenerator._instance = None
		self._initialized = False
		self._chromium_process = None
		self._devtools_url = None

	# not used anywhere in the code. read _set_devtools_url for more info.  useful in case we want to take different approch to fetch devtools url.
	def fetch_devtools_url(self, port):
		if not port:
			return None
		url = f"http://127.0.0.1:{port}/json/version"
		try:
			response = requests.get(url)
			response.raise_for_status()  # Raise an exception for HTTP errors
			response_data = response.json()
			return response_data["webSocketDebuggerUrl"].strip()
		except requests.ConnectionError:
			frappe.log_error(
				f"Failed to connect to the Chrome DevTools Protocol. Is Chrome running with --remote-debugging-port={port}"
			)
		except requests.RequestException as e:
			frappe.log_error(f"An error occurred: {e}")
		return None
