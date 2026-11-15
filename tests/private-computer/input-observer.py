#!/usr/bin/env python3
"""Guest-only X input fixture. Observe actual key/clipboard effects on our own screen."""
import os,sys,json
from pathlib import Path
import gi
bridge=Path(os.environ['HQ_ROOT'])/'runtime/x11/usr/lib/python3/dist-packages/gi'
if bridge.exists():gi.__path__.append(str(bridge))
gi.require_foreign('cairo');gi.require_version('Gtk','3.0')
from gi.repository import Gtk,Gdk,GLib
state={'text':'','clipboard':None,'clipboardReady':False,'keys':0};dest=Path(sys.argv[1])
def save():dest.write_text(json.dumps(state))
win=Gtk.Window(title='HQInputProof');win.set_default_size(320,90);entry=Gtk.Entry();win.add(entry)
def change(_entry):state['text']=entry.get_text();save()
def key(_entry,_event):state['keys']+=1;save();return False
entry.connect('changed',change);entry.connect('key-press-event',key)
clip=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
def got_text(_clip,text,_data):state['clipboard']=text;state['clipboardReady']=True;save()
def owner_change(_clip,_event):clip.request_text(got_text,None)
def poll_clipboard():clip.request_text(got_text,None);return True
GLib.timeout_add(200,poll_clipboard)
clip.connect('owner-change',owner_change);win.connect('destroy',Gtk.main_quit);win.show_all();entry.grab_focus();save();Gtk.main()
